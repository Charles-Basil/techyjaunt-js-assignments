# KoboMarket

A multi-vendor marketplace API with wallets, a double-entry ledger and escrow.

- **Node.js 22 + Express 5**
- **MongoDB (Mongoose)**: users, products, cart, notifications
- **PostgreSQL (pg + Knex)**: all money: accounts, ledger, orders, payouts, disputes
- All money is stored as **BIGINT kobo** (100 kobo = NGN 1). Never floats.

## Setup

Requirements: Docker Desktop (and Node.js 22+ if you want to run outside Docker).

```powershell
cd KoboMarket
Copy-Item .env.example .env
docker compose up --build
```

Then open:

- Health check: http://localhost:3000/health
- API docs (Swagger UI): http://localhost:3000/api-docs

When the `api` container starts, it runs all migrations before the server starts.

Load demo data (admin, 3 vendors, 20 products, 5 funded buyers; see "Seed data"):

```powershell
docker compose exec api npm run seed -- --reset
```

### Running the API outside Docker (optional)

Start only the databases in Docker, then run the API with nodemon:

```powershell
cd KoboMarket
docker compose up -d mongo postgres
npm install
npm run migrate
npm run dev
```

Docker exposes MongoDB on `localhost:27017` and Postgres on `localhost:5433`
(not 5432, because a Postgres is already installed on this machine and listens
on 5432). Both are bound to 127.0.0.1, so only your own machine can reach them.
`.env` already uses `PG_PORT=5433`. Inside Docker, the API uses `postgres:5432`
and `mongo:27017`.

## Running the tests

Tests use **separate databases** (`kobomarket_test` in Mongo and Postgres), so
they never touch your dev data. The Docker databases must be running.

```powershell
cd KoboMarket
Copy-Item .env.test.example .env.test   # first time only; PG_USER/PG_PASSWORD must match .env
docker compose up -d mongo postgres
npm test
```

- `tests/globalSetup.js` refuses to run unless both database names end in `_test`,
  creates the `kobomarket_test` Postgres database if needed, and runs all migrations.
- Before every test, all Mongo collections, the Postgres order tables and user wallets are wiped (system accounts stay).
- Tests read verification/reset tokens by spying on the mailer (`jest.spyOn`), not from logs.

## Auth overview

- **Passwords**: bcrypt, cost 12 (`BCRYPT_COST`; tests use 4 for speed, production refuses less than 10). Rule: 8 to 72 characters, at least one letter and one number.
- **Email verification / password reset tokens**: 32 random bytes. Only the sha256
  hash is stored. Verification expires in 24h, reset in 30 min, and each token works once.
- **Access token**: JWT (HS256), 15 minutes, payload `{ sub: userId, roles }`.
  `authenticate` reloads the user from MongoDB on every request, so a role change
  or a freeze takes effect immediately, even for tokens issued earlier.
- **Refresh token**: 64 random bytes, only the sha256 hash is stored, 7 days, **single use**.
  Each `/auth/refresh` revokes the old token and issues a new one in the same
  `familyId` (one family = one login session). If a revoked token is ever sent
  again, someone has a copy they shouldn't have, so **every** refresh token of
  that user is revoked (`TOKEN_REUSE_DETECTED`).
- **RBAC**: only `requireRole(...)` middleware checks roles. Controllers never do.
- **Login rate limit**: 5 failed attempts per 15 minutes per `email:ip`. Successful logins don't count.
- **Emails** are not really sent: the dev mailer logs the link. Find it with
  `docker compose logs api`, then search the output for "EMAIL (dev mailer)".

## Marketplace: vendors, products, reviews, cart

- **Becoming a vendor**: `POST /vendors/apply` (PENDING), then an admin calls
  `PATCH /admin/vendors/:applicationId/approve`. APPROVED adds the `VENDOR` role
  (`$addToSet`). Only APPROVED vendors can create products. Bank account numbers
  are masked (`******6789`) in every response.
- **Two different ids**: `/vendors/:id` takes the vendor's **user id** (the same
  value as `product.vendorId`). Admin routes take the **application id**.
- **Products** are soft-deleted (`isDeleted`, `deletedAt`), so they vanish from
  shoppers but old orders still point at them. Ownership ("is this MY product?")
  is checked in the service. Roles are checked only in `requireRole` middleware.
- **Cursor pagination** (`src/utils/pagination.js`): the cursor is base64 JSON of
  `{ sortValue, _id }` of the last item. The next page asks for "after that point":
  `{ $or: [ { price: { $gt: v } }, { price: v, _id: { $gt: id } } ] }` sorted by
  `{ price: 1, _id: 1 }`. `_id` breaks ties, so items with equal prices are never
  skipped or repeated. We fetch `limit + 1` items to know if there is another page.
  Unlike `skip()`, this stays fast on page 1,000.
- **Reviews** need a COMPLETED sub-order for that product (a Postgres join across
  `order_items`, `sub_orders` and `orders`). The rating average is updated inside
  MongoDB with one pipeline update, so two simultaneous reviews can't overwrite
  each other.
- **Cart** stores price and name *snapshots* for display only. `GET /cart` and
  `cartService.validateForCheckout()` always re-read the current price and stock.
  Each item is flagged `priceChanged`, `outOfStock` or `unavailable`. Products with
  variants must be added with a `variantId`. Concurrent edits to the same cart
  return `409 CART_CONFLICT` instead of losing one of the changes (Mongoose
  `optimisticConcurrency`).

## Double-entry ledger

All money lives in PostgreSQL as **BIGINT kobo**. In JavaScript, money maths uses
**BigInt** (`1500n + 250n`). Postgres returns BIGINT as a string, so it is converted
with `BigInt(value)`. Responses use plain JSON numbers via `toKoboNumber()`, which
throws rather than return a rounded number above `Number.MAX_SAFE_INTEGER`.

**Accounts** (`accounts` table): one NGN wallet per user, plus system accounts:

| Code | What it holds |
| --- | --- |
| `PLATFORM_ESCROW` | Buyer money held until an order completes |
| `PLATFORM_REVENUE` | Commission the platform earned |
| `PLATFORM_PAYOUT_CLEARING` | Vendor money on its way to a bank |
| `PLATFORM_EXTERNAL_SETTLEMENT` | The outside world (Paystack, banks). May go negative |

**Sign convention, the same for every account:**

```
balance_kobo = SUM(credits) - SUM(debits)
```

A CREDIT adds to a balance and a DEBIT takes from it. Every transaction's debits equal
its credits, so **the sum of all balances is always exactly 0**.

**The external settlement account** is how money enters and leaves the system:

| Event | DEBIT | CREDIT |
| --- | --- | --- |
| Wallet funding | `PLATFORM_EXTERNAL_SETTLEMENT` | user wallet |
| Payout settled (later block) | `PLATFORM_PAYOUT_CLEARING` | `PLATFORM_EXTERNAL_SETTLEMENT` |

After NGN 2,500 is funded, the wallet is `+250000` and external is `-250000`.
"External is negative 250000" reads as "250000 kobo came in from outside".

**Money identity** (checked by the audit):

```
user wallets + escrow + revenue + payout clearing  =  total funded - total paid out
                                                    =  -(external balance)
```

**Rules enforced in code and in the database:**

- `src/ledger/ledger.service.js` is the **only** code that inserts `ledger_entries`
  or changes `balance_kobo`. Its `postTransaction(trx, ...)`:
  1. refuses to run outside a Knex transaction;
  2. validates *before writing anything*: at least 2 entries, every amount a
     positive BigInt, and debits = credits (otherwise `LEDGER_UNBALANCED`, a 500,
     because it is a bug in our code);
  3. locks every account row with `SELECT ... FOR UPDATE ORDER BY id`. A fixed lock
     order means two transfers between the same accounts can never deadlock;
  4. inserts the transaction, its entries, and one `UPDATE balance = balance + change`
     per account (the arithmetic happens in Postgres);
  5. runs inside a **savepoint**, so a failure leaves nothing behind and the caller's
     outer transaction is still usable.
- A user wallet can't go negative: `CHECK (owner_type = 'SYSTEM' OR balance_kobo >= 0)`.
  The ledger turns that error (23514) into `402 INSUFFICIENT_FUNDS`. Because the check
  is in the database, it holds even when two debits race each other (there's a test).
- `ledger_entries` (and `webhook_events`) are **append-only**: a trigger rejects
  UPDATE and DELETE. Mistakes are fixed with a new, reversing transaction.
- A reused transaction `reference` or `idempotency_key` gives `409 DUPLICATE_TRANSACTION`.

**Ledger audit:** `npm run audit:ledger` (dev database) or
`$env:NODE_ENV='test'; npm run audit:ledger` (test database). Each check is one SQL aggregate:

1. every transaction balances (and has at least 2 entries);
2. every stored balance = credits - debits of that account's entries;
3. the sum of all balances = 0;
4. the money identity above.

It prints PASS/FAIL per check and exits with code 1 on failure.

## Wallet funding and webhook idempotency

```
POST /wallet/fund ──> wallet_fundings row PENDING ──> Paystack payment page
                                                          │ buyer pays
Paystack ──> POST /webhooks/paystack (charge.success, maybe several times)
```

1. **Signature first.** `x-paystack-signature` must equal HMAC-SHA512 (hex) of the
   **raw** request bytes (`express.json({ verify })` keeps them in `req.rawBody`),
   compared with `crypto.timingSafeEqual`. Missing or wrong: `401 INVALID_SIGNATURE`,
   recorded, nothing processed.
2. **Never trust the webhook body.** We call Paystack's verify API and require
   status `success`, currency `NGN` and **amount equal to the funding's amount_kobo**.
   If not, nothing is credited and the reason is recorded. The funding becomes
   FAILED only if Paystack itself says the payment failed. If Paystack can't be
   reached, we answer 500 so Paystack retries later.
3. **Credit in one Postgres transaction**: lock the funding row, check it isn't
   SUCCESS yet, post DEBIT external / CREDIT wallet, set the funding to SUCCESS.
4. Every webhook is written to `webhook_events` (append-only) with its result:
   `CREDITED`, `ALREADY_PROCESSED`, `VERIFY_FAILED`, `UNKNOWN_REFERENCE`,
   `MARKED_FAILED`, `IGNORED` or `INVALID_SIGNATURE`.
5. Every validly signed event gets `200 { received: true }`, so Paystack stops retrying.

**Why a payment is credited exactly once**, even if Paystack sends the webhook 3
times or 2 copies arrive at the same moment:

| Layer | What it stops |
| --- | --- |
| `SELECT ... FOR UPDATE` on the funding row | Two copies at the same time: the second **waits** until the first commits |
| `status = 'SUCCESS'` check after taking the lock | The waiting copy (and any later copy) sees SUCCESS and does nothing |
| `UNIQUE (idempotency_key)` = `paystack:<reference>` on `transactions` | Last line of defence: even buggy code can't post the same payment twice |

The tests send duplicates one after another and at the same time with
`Promise.all`. With the guards removed on purpose, those tests fail.

Funding a **frozen** wallet is still recorded (`allowFrozen`): the money really
arrived at Paystack, so the books must show it. Freezing blocks spending, not
recording a payment the user made.

**Mock Paystack** (`PAYSTACK_MODE=mock`, default; never mounted in production):
`authorizationUrl` points at `GET /mock-paystack/checkout/:reference`.
`POST /mock-paystack/checkout/:reference/pay { outcome, duplicates }` marks the
payment and sends `duplicates` real signed webhooks to `WEBHOOK_TARGET_URL`.
Set `PAYSTACK_MODE=live` with a Paystack **test** secret key to use the real API.

## Idempotency-Key

Money endpoints (`POST /wallet/fund` now, checkout and payouts later) require an
`Idempotency-Key` header (8-100 characters of `A-Z a-z 0-9 _ -`). Generate one per
user action and reuse it **only** to retry that same action.

| Situation | Result |
| --- | --- |
| First request | Runs. The status and body are stored **before** the response is sent |
| Same key + same body again | Stored response replayed, header `Idempotent-Replayed: true`. The handler does **not** run again |
| Same key + different body | `409 IDEMPOTENCY_KEY_REUSED` |
| Same key while the first request is still running | `409 REQUEST_IN_PROGRESS` |
| First request ended in a 5xx | Row deleted: a retry with the same key runs again |
| No header | `400 IDEMPOTENCY_KEY_REQUIRED` |

- 4xx answers are stored too (same key + same body = same answer).
- Keys are scoped per user **and** per endpoint (`POST /api/v1/wallet/fund`).
- "Request hash" = sha256 of the body as JSON with sorted keys, so key order doesn't matter.
- `INSERT ... ON CONFLICT DO NOTHING` decides atomically which of two simultaneous
  identical requests runs.
- Known limit: if the server crashes mid-request, that key stays "in progress"
  (409) until the row is removed. A cleanup job for old in-progress rows can come later.

## Checkout and escrow

`POST /orders/checkout` (auth, not frozen, `Idempotency-Key` required):

- `{}` checks out **the cart**. `{ "items": [...] }` is **buy now** and leaves the cart alone.
  Both go through the same `placeOrder` service.
- Prices are always re-read from the product (cart prices are only snapshots).
  Problems are all listed in one `409 CART_INVALID`. Buying your own product is
  `400 CANNOT_BUY_OWN_PRODUCT`.
- One **order** per checkout, one **sub-order per vendor**, one **order_item** per product line.
- The buyer's money moves into escrow immediately:

| Moment | DEBIT | CREDIT |
| --- | --- | --- |
| Checkout (`ORDER_PAYMENT:<orderId>`) | buyer wallet: total | `PLATFORM_ESCROW`: total |
| Buyer confirms / 72h after shipping (`ORDER_RELEASE:<subOrderId>`) | `PLATFORM_ESCROW`: subtotal | vendor wallet: subtotal - commission, `PLATFORM_REVENUE`: commission |
| Cancel / out of stock (`ORDER_REFUND:<orderId>`) | `PLATFORM_ESCROW` | buyer wallet |

- **Commission** = `subtotal * bps / 10000` in BigInt, which rounds **down**: 333 kobo
  at 5% gives 16 commission and 317 to the vendor. The rate is **copied onto each
  sub-order at checkout**, so an admin changing `settings.commission_rate_bps`
  later never changes an existing order.
- Every ledger reference above is UNIQUE: an order can't be paid twice, a sub-order
  can't be released twice, and an order can't be refunded twice.
- **Auto-complete** (`src/jobs/autoComplete.job.js`, `AUTO_COMPLETE_CRON`, default
  every minute): sub-orders SHIPPED or DELIVERED more than `ESCROW_TIMEOUT_HOURS`
  (72) ago, with no OPEN dispute, are completed and released by the `SYSTEM` actor.
  DISPUTED sub-orders are never selected. Each row is locked with
  `FOR UPDATE SKIP LOCKED` and the conditions are re-checked under the lock, so a
  dispute opened a second earlier, or a buyer confirming at the same moment, wins
  cleanly.
- **Cancel** (`POST /orders/:id/cancel`): only while nothing has shipped (every
  non-cancelled sub-order is PAID). Refund and status changes happen in one
  transaction; stock goes back to MongoDB after commit.

## Order state machine

Every status change goes through `orderStateMachine.transition()`
(`src/modules/orders/orderStateMachine.js`):

```
                     ┌──────────> CANCELLED            (buyer cancels / out of stock)
                     │
PENDING_PAYMENT ──> PAID ──> SHIPPED ──────────────┬──> COMPLETED   (escrow released)
                               │                   │       ▲
                               ├──> DELIVERED ─────┤       │
                               │       │           │       │
                               │       ▼           │       │
                               └──> DISPUTED ──────┴───────┘
                                       │
                                       └──> REFUNDED   (next block)

COMPLETED, CANCELLED and REFUNDED are final.
```

| From | Allowed next |
| --- | --- |
| PENDING_PAYMENT | PAID, CANCELLED |
| PAID | SHIPPED, CANCELLED |
| SHIPPED | DELIVERED, COMPLETED, DISPUTED |
| DELIVERED | COMPLETED, DISPUTED |
| DISPUTED | COMPLETED, REFUNDED |
| COMPLETED, CANCELLED, REFUNDED | (none) |

- An illegal move gives `409 INVALID_STATE_TRANSITION` with `{ from, to, allowed }`.
- The update is `UPDATE ... WHERE id = ? AND status = <the status we read>`. If
  another request changed it first, 0 rows match and we answer 409 instead of
  overwriting their change.
- Every change writes a row to **`sub_order_events`** (append-only: who, which role,
  from, to, note).
- The parent **order status** is recomputed from its sub-orders: all CANCELLED gives
  CANCELLED; all final with at least one COMPLETED gives COMPLETED; all REFUNDED or
  CANCELLED with at least one REFUNDED gives REFUNDED; anything else is IN_PROGRESS.
- **Why sub-orders start in PAID:** the wallet pays at the same instant the order is
  created, inside the same transaction. There is no moment when an order exists
  unpaid. To keep the history complete, checkout still writes a
  `PENDING_PAYMENT -> PAID` event.

## Concurrency

| Danger | What stops it |
| --- | --- |
| Spending the same wallet balance twice | Checkout locks the buyer wallet row (`SELECT ... FOR UPDATE`) **before** reading the balance. A second checkout by the same buyer waits, then reads the reduced balance. The DB `CHECK (balance_kobo >= 0)` is the second safety net. |
| Deadlocks | Every flow locks rows in one order: **order row, then sub-order rows, then accounts by id** (`ledger.lockAccounts`). Two flows can never each hold a lock the other needs, even when one user is both buyer and vendor (there is a test). |
| Overselling the last item | MongoDB `updateOne({ _id, stock: { $gte: qty } }, { $inc: { stock: -qty } })`: the check and the decrement are **one atomic operation**, so stock can't go below 0 |
| Two releases of the same sub-order | Row lock + status check + unique ledger reference `ORDER_RELEASE:<id>` |
| Double-clicked checkout | Idempotency-Key middleware, plus UNIQUE `orders.idempotency_key` (`<userId>:<key>`) as the database backstop |

**Why exactly 3 of 10 parallel checkouts succeed** (wallet = 3 x price): all 10
requests reach the transaction at once, but only one can hold the wallet's row
lock. It sees enough money, pays and commits. The next one gets the lock and sees
the *new* balance, and so on. After 3 commits the balance is 0, so the remaining 7
each see "not enough" and get `402`, without creating anything. The test asserts
exactly `3 x 201 + 7 x 402`, a final balance of 0, 3 orders, and a passing audit.

## Cross-database consistency: checkout

The order and the money live in **PostgreSQL**; the stock lives in **MongoDB**.
They can't share a transaction, so checkout uses **compensation** and a **recovery job**:

```
a) Mongo     validate products, current prices, stock          (read only)
b) Postgres  ONE transaction: lock wallet + escrow, check balance,
             insert order/sub-orders/items, ORDER_PAYMENT       -> stock_status PENDING
c) Mongo     take stock, one conditional $inc per item
d) failed?   put back what was taken, then ONE Postgres transaction:
             ORDER_REFUND, sub-orders -> CANCELLED              -> stock_status RELEASED
             (409 OUT_OF_STOCK, or 503 if MongoDB itself failed)
e) success   stock_status DEDUCTED, remove the bought lines from the cart, emit 'order.placed'
```

- **Why Postgres first:** the money step is the one that must never be wrong. Once it
  commits we *know* the buyer paid, and we can always undo it with a refund.
- **Crash between b and c:** the order is stuck with `stock_status = PENDING`.
  `src/jobs/stockRecovery.job.js` runs every minute. Each PENDING order older than
  5 minutes is locked with `FOR UPDATE SKIP LOCKED` and compensated exactly like
  step d. Compensation only acts while `stock_status` is still PENDING (checked under
  the row lock) and the refund reference is unique, so the request and the job can
  never both refund.
- **The trade-off we chose:** the job **never takes stock**. If the crash happened
  halfway through step c, a few units stay decremented for a cancelled order, so the
  shop shows slightly *less* stock than it has. That's the safe direction: we may
  under-count, but we can never sell an item we don't have.
- If a request is stuck for over 5 minutes and the job compensates first, the final
  `PENDING -> DEDUCTED` update matches 0 rows. The request then puts its stock back
  and answers `409 CHECKOUT_EXPIRED`, and the buyer was refunded by the job.
- `order.placed`, `order.shipped`, `order.cancelled` and `funds.released` are emitted
  on `src/events/emitter.js` after commit, on a later tick. A failing listener can
  never break a request.

## Disputes and refunds

1. The buyer opens a dispute on a **SHIPPED or DELIVERED** sub-order
   (`POST /sub-orders/:id/disputes`, with a reason and up to 10 text/image evidence items).
   In one transaction the dispute row is inserted OPEN and the sub-order moves to **DISPUTED**.
   A partial unique index allows only one OPEN dispute per sub-order (`409 DISPUTE_ALREADY_OPEN`).
2. The escrow is now **frozen**: the auto-complete job skips the sub-order twice over
   (its status is no longer SHIPPED/DELIVERED, *and* `NOT EXISTS` an OPEN dispute).
   The buyer can't confirm it either.
3. An ADMIN resolves it (`PATCH /disputes/:id/resolve`, a note is required). One
   transaction locks order, sub-order, dispute, then accounts (in id order), and posts
   **one** balanced ledger transaction, `DISPUTE_RESOLUTION:<disputeId>`:

| Resolution | Ledger | Sub-order |
| --- | --- | --- |
| `FULL_REFUND` | escrow -> buyer (subtotal) | REFUNDED |
| `PARTIAL_REFUND` | escrow -> buyer (refund), vendor (rest - commission), revenue (commission) | COMPLETED |
| `REJECTED` | normal release: escrow -> vendor (95%), revenue (5%), via the same `releaseInTransaction()` code as buyer confirm | COMPLETED |

**Partial refund example** (subtotal 100000, refund 40000, 500 bps). Commission is
charged only on the part the vendor keeps:

```
vendor part = 100000 - 40000                = 60000
commission  = 60000 * 500 / 10000           =  3000   (BigInt, rounds down)
DEBIT  escrow   100000
CREDIT buyer     40000
CREDIT vendor    57000   (60000 - 3000)
CREDIT revenue    3000
```

- The dispute row records `resolved_by` (the admin id), `resolution_note` and
  `resolved_at`. A `sub_order_events` row records the same admin and note.
- **Never twice:** the dispute row is locked and must be OPEN (`409 DISPUTE_ALREADY_RESOLVED`).
  The ledger reference is unique. And every escrow settlement of a sub-order (confirm,
  auto-complete or any resolution) uses the same unique idempotency key
  `ESCROW_SETTLEMENT:<subOrderId>`, so one sub-order's escrow can be paid out only once,
  whichever path tries. A test has two admins resolving at the same moment: exactly one wins.
- Resolutions use `allowFrozen`: an admin's decision must always be able to settle escrow,
  even if a wallet is frozen.

## Vendor payouts

```
POST /payouts ─> wallet ──PAYOUT_REQUEST──> PLATFORM_PAYOUT_CLEARING      payout PENDING
                                                    │
payouts job (every minute, PAYOUT_JOB_CRON):        │  claim -> PROCESSING -> bank transfer
   transfer success ──PAYOUT_SETTLED──> PLATFORM_EXTERNAL_SETTLEMENT     payout SUCCESS
   transfer failed  ──PAYOUT_REVERSAL──> back to the vendor wallet        payout FAILED
```

- **Request** (`VENDOR`, not frozen, `Idempotency-Key`): needs an APPROVED vendor
  profile with bank details, and at least `PAYOUT_MIN_KOBO` (NGN 1,000). In one
  transaction: lock the wallet and clearing accounts, check the balance, insert the
  payout PENDING with a **masked** bank snapshot (the full account number stays only
  in the vendor profile), then post `PAYOUT_REQUEST`. **The money leaves the wallet
  immediately**, so it can't be spent or withdrawn twice while the transfer runs.
- **Same-millisecond protection:** two requests at the same instant both need the
  wallet row lock, so they run one after the other. The second one sees either the
  reduced balance (`402`) or the first payout (the partial unique index "one
  PENDING/PROCESSING payout per vendor" gives `409 PAYOUT_ALREADY_PENDING`). A vendor
  can never withdraw more than their balance (tested with `Promise.all`).
- **The job** (`src/jobs/payouts.job.js`) claims up to 10 PENDING payouts in **one**
  statement: `UPDATE ... SET status = 'PROCESSING', attempts = attempts + 1 WHERE id IN
  (SELECT ... FOR UPDATE SKIP LOCKED) RETURNING *`. Two job runs or two servers can
  never claim the same payout. Each payout calls `initiateTransfer` with
  **reference = payout id**, so the provider itself refuses to send the same payout twice.
  - success: `settle()`. Lock the payout (must be PROCESSING), clearing to external
    (`PAYOUT_SETTLED:<id>`), status SUCCESS.
  - failed: `fail()`. Clearing back to the vendor wallet (`PAYOUT_REVERSAL:<id>`,
    `allowFrozen`), status FAILED with the reason. The vendor can request again.
  - pending (live Paystack, e.g. OTP): stays PROCESSING until `transfer.success` /
    `transfer.failed` arrives on the webhook (re-verified, then the **same**
    `settle()`/`fail()`), or the recovery check below.
  - **the provider threw** (network error: outcome *unknown*): back to PENDING with
    `last_error`, and retried next run. After 5 attempts we ask `verifyTransfer` once more
    (never refund money that actually left), and if it didn't go through, `fail()`
    returns the money.
- **Crash recovery:** a payout PROCESSING for 15+ minutes is checked with
  `verifyTransfer`: success settles it, failed fails it, "never received" puts it back
  to PENDING, and unknown leaves it and logs.
- Audit check (d) counts `PAYOUT_SETTLED` as money that left the platform, so after a
  payout, `wallets + escrow + revenue + clearing = funded - paid out` still holds.
- **Mock transfers** succeed unless the bank account number ends in `0000` or
  `MOCK_TRANSFER_OUTCOME=failed`.
- Known limit (live mode only): if Paystack is unreachable for all 5 attempts *and*
  for the verify call, the payout is failed and refunded. If that transfer later turns
  out to have succeeded, the `transfer.success` webhook finds the payout FAILED, records
  it, and an admin must reconcile it by hand.

`npm test` ends with `posttest` (`scripts/audit-test-db.js`): the ledger audit on the
test database. If the books don't balance, `npm test` fails.

## Notifications

In-app notifications (MongoDB `notifications`), created from domain events:

| Event | Who gets a notification |
| --- | --- |
| `order.placed` | the buyer + each vendor in the order |
| `order.shipped` | the buyer |
| `funds.released` | the vendor |
| `dispute.opened` | the vendor + every ADMIN |
| `dispute.resolved` | the buyer + the vendor |
| `payout.success` / `payout.failed` | the vendor |

- `src/events/listeners/notification.listener.js` subscribes once, when `app.js` loads.
  Each handler runs on a **later tick** (`setImmediate`), after the HTTP response has
  been sent. It catches and logs its own errors and is never awaited, so a broken
  notification can never break a checkout (there is a test that makes the listener throw).
- **No duplicates:** every notification has a `dedupeKey` (e.g. `ORDER_PLACED:<orderId>`),
  unique per user, and is written with an upsert. The same event handled twice creates
  one notification.
- Endpoints (your own notifications only): `GET /notifications` (cursor, `?unread=true`),
  `GET /notifications/unread-count`, `PATCH /notifications/:id/read` (someone else's id
  returns 404), `PATCH /notifications/read-all` (returns how many changed).

**Why an in-process `EventEmitter`, and its limit.** It's the simplest thing that works:
no broker to run, and events are emitted only **after** the database transaction
commits, so a listener never sees something that was rolled back. The limit: if the
process crashes between the commit and the listener running, that notification is
**lost** (the money is safe; only the message is missing). An **outbox** would fix
that: write the event into the `outbox` table *inside the same transaction* as the
money change, and let a worker read unsent rows, deliver them, and mark them sent.
Then an event exists if and only if the change committed, and a crash only delays it
(the worker retries; the dedupe key makes retries harmless). The `outbox` table
already exists for that next step.

## Admin and reports

Every route under `/api/v1/admin` requires ADMIN through one router-level
`requireRole('ADMIN')` (a test calls all of them as a buyer and expects 403).

| Endpoint | What it does |
| --- | --- |
| `GET /admin/users?q=&role=&status=` | Search users (email or name, case-insensitive; regex characters are escaped) |
| `PATCH /admin/users/:id/freeze` `{ frozen, reason }` | Freeze/unfreeze in **both** databases (below) |
| `GET /admin/wallets/:accountId/ledger` | One account + its full history, each entry with its counter-entries |
| `GET /admin/transactions?type=&from=&to=` | Every ledger transaction with its entries |
| `PATCH /admin/settings/commission` `{ commissionRateBps }` | 0 to 5000. Only NEW checkouts use it |
| `GET /admin/audit-log` | Append-only log of admin decisions |
| `GET /admin/reports/...` | Reports (below) |

**Freezing a user** sets `users.status` in MongoDB first, then `accounts.status` in
Postgres plus an audit-log row (in one Postgres transaction). If Postgres fails, the
MongoDB change is reverted and the API answers 500, so the two databases never
disagree. Freezing also revokes every refresh token. A frozen user is stopped three
ways: login refuses them, `notFrozen` blocks checkout, funding and payouts, and the
ledger refuses to move money on a FROZEN account. An admin can't freeze themselves.

**Audit log** (`admin_audit_log`, append-only trigger): vendor approve/reject,
freeze/unfreeze, commission change and dispute resolution, each with
before/after/note. Dispute, freeze and commission rows are written in the **same
transaction** as the change. Vendor decisions live in MongoDB, so their row is
written right after (a failure there is logged, not hidden).

**Reports**: raw SQL with bound parameters, all aggregation in Postgres, days in
`Africa/Lagos`:

```jsonc
// GET /admin/reports/revenue?from=2026-11-20&to=2026-11-22
// credits - debits on PLATFORM_REVENUE per Lagos day; generate_series fills empty days with 0
{ "from": "2026-11-20", "to": "2026-11-22", "totalKobo": 15000,
  "days": [ { "date": "2026-11-20", "revenueKobo": 0 },
            { "date": "2026-11-21", "revenueKobo": 5000 },
            { "date": "2026-11-22", "revenueKobo": 10000 } ] }

// GET /admin/reports/top-vendors?month=2026-11   (default: this month in Lagos)
// COMPLETED sub-orders in the month; store names from MongoDB in ONE $in query
{ "month": "2026-11",
  "vendors": [ { "rank": 1, "storeName": "Lagos Gadget Hub", "completedCount": 2,
                 "grossKobo": 200000, "commissionKobo": 10000, "refundedKobo": 0, "netKobo": 190000 } ] }

// GET /admin/reports/escrow
{ "escrowBalanceKobo": 400000, "openSubOrdersTotalKobo": 400000, "matches": true,
  "breakdown": [ { "status": "PAID", "count": 2, "totalKobo": 300000 },
                 { "status": "SHIPPED", "count": 1, "totalKobo": 100000 },
                 { "status": "DELIVERED", "count": 0, "totalKobo": 0 },
                 { "status": "DISPUTED", "count": 0, "totalKobo": 0 } ] }

// GET /admin/reports/reconciliation   (same SQL as the ledger audit; should always be empty)
{ "ok": true, "mismatches": [] }
```

`netKobo` = what the vendor was actually paid = gross - commission - partial refunds.
The escrow report's `matches` should always be true: every kobo in escrow belongs to
exactly one open (PAID / SHIPPED / DELIVERED / DISPUTED) sub-order.

## Seed data

```powershell
npm run seed                                     # from your machine (.env, localhost ports)
docker compose exec api npm run seed             # inside Docker
docker compose exec api npm run seed -- --reset  # wipe dev data first, for a clean demo
```

- Refuses to run when `NODE_ENV=production`.
- **Idempotent:** if `admin@kobomarket.test` exists, it prints "already seeded" and
  exits 0. `--reset` wipes the MongoDB collections and the Postgres data
  (`TRUNCATE ... CASCADE`; the migrations table is kept), re-creates the system
  accounts and settings, then seeds.
- Buyers are funded with a real `WALLET_FUNDING` ledger transaction (DEBIT external,
  CREDIT wallet). The seed ends by printing a table of accounts and running the ledger audit.

**Every account's password: `Password123`** (all emails already verified)

| Email | Role | Notes |
| --- | --- | --- |
| admin@kobomarket.test | ADMIN | |
| vendor1@kobomarket.test | VENDOR | Lagos Gadget Hub (electronics, home) |
| vendor2@kobomarket.test | VENDOR | Ankara & Aso Couture (fashion, beauty) |
| vendor3@kobomarket.test | VENDOR | Naija Pantry (groceries, home, beauty). Bank account ends in **0000**, so payouts FAIL (demo) |
| buyer1..5@kobomarket.test | BUYER | NGN 50,000 in the wallet each |

20 products across electronics, fashion, home, beauty and groceries. Four have
variants with their own price and stock (phone colours, dress sizes,
shirt size/colour, slipper size/colour).

## Cross-database consistency: user -> wallet

Users live in **MongoDB** and wallets (the `accounts` table) live in **PostgreSQL**.
The two databases can't take part in one transaction, so we can't create both
"all or nothing". Instead:

1. **Register** saves the user in Mongo with `walletStatus: PENDING`.
2. It then calls `walletService.ensureWallet(userId)`, which runs
   `INSERT INTO accounts (owner_type, owner_id, currency) VALUES ('USER', <userId>, 'NGN')
   ON CONFLICT (owner_type, owner_id, currency) DO NOTHING`.
   The unique constraint makes this **idempotent**: running it once or 100 times
   leaves exactly one wallet row.
3. Only after Postgres succeeds is the user updated to `walletStatus: CREATED`.
4. If the Postgres step fails (database down, timeout...), registration **still
   succeeds**. The error is logged and the user stays `PENDING`.
5. The **wallet reconciler** job (`src/jobs/walletReconciler.job.js`, node-cron,
   every minute) finds up to 100 users that are `PENDING` and older than 30 seconds,
   and calls `ensureWallet` again. The 30-second wait avoids racing a registration
   that is still in progress.
6. Wallet routes (later blocks) will also call `ensureWallet` lazily as a last safety net.

Why this is safe: every step can be repeated. If step 3 fails after step 2
succeeded, the next retry just runs the `INSERT` again (no-op) and then step 3 again.
The worst case is a short delay before the wallet is marked `CREATED`, never a
duplicate or missing wallet.

## Scripts

| Script                     | What it does                                  |
| -------------------------- | --------------------------------------------- |
| `npm run dev`              | Start with nodemon (auto-restart)             |
| `npm start`                | Start with node                               |
| `npm run migrate`          | Run all pending Postgres migrations           |
| `npm run migrate:rollback` | Undo the last batch of migrations             |
| `npm run seed`             | Demo data (`-- --reset` wipes dev data first) |
| `npm test`                 | Run Jest tests, then the ledger audit on the test DB |
| `npm run audit:ledger`     | Ledger consistency audit (exit code 1 on FAIL) |
| `npm run job -- <name>`    | Run one background job once: `payouts`, `auto-complete`, `stock-recovery`, `wallet-reconciler` |

## Project structure

```
src/
  app.js              Express app (middleware, routes, error handling)
  server.js           Connects DBs, starts HTTP, graceful shutdown
  config/             env (zod-validated), logger (pino), mongo, knex
  middlewares/        requestId, errorHandler, notFound, validate, auth, rbac, notFrozen, idempotency
  routes/             /health and the /api/v1 router
  modules/            One folder per feature (routes -> controllers -> services -> repositories)
  jobs/               walletReconciler, autoComplete (escrow timeout), stockRecovery (checkout crash safety), payouts
  policies/           order, dispute and payout access rules
  utils/              AppError, cursor pagination, slugs, tokens, shared zod schemas
  ledger/             ledger.service.js (the only code that moves money), audit.js
  integrations/       paystack.client.js (mock or live provider)
  mock-paystack/      Fake Paystack: provider, checkout routes, signed webhook sender
  events/             emitter.js (in-process domain events) + listeners/ (notifications)
  seed/               demo data and the seed logic (used by npm run seed and tests)
db/migrations/        Knex migrations (Postgres)
db/seeds/             Knex seeds
docs/openapi.yaml     API documentation served at /api-docs
scripts/              CLI scripts (ledger audit)
tests/                Jest + supertest
```


## Error format

Every error response has the same shape:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "...", "details": [] } }
```

## Database rules enforced by Postgres itself

- User account balances can never go negative (`CHECK`).
- `ledger_entries` is append-only: a trigger raises an error on `UPDATE`/`DELETE`.
- One `PENDING`/`PROCESSING` payout per vendor (partial unique index).
- One `OPEN` dispute per sub-order (partial unique index).
- `order_items.line_total_kobo = unit_price_kobo * quantity` (`CHECK`).
