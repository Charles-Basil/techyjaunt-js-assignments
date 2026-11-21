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

- **Passwords**: bcrypt, cost 12. Rule: 8 to 72 characters, at least one letter and one number.
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
| `npm run seed`             | Run seed files (placeholder for now)          |
| `npm test`                 | Run Jest tests                                |
| `npm run audit:ledger`     | Ledger consistency audit (exit code 1 on FAIL) |

## Project structure

```
src/
  app.js              Express app (middleware, routes, error handling)
  server.js           Connects DBs, starts HTTP, graceful shutdown
  config/             env (zod-validated), logger (pino), mongo, knex
  middlewares/        requestId, errorHandler, notFound, validate, auth, rbac, notFrozen, idempotency
  routes/             /health and the /api/v1 router
  modules/            One folder per feature (routes -> controllers -> services -> repositories)
  jobs/               Background jobs (walletReconciler.job.js)
  utils/              AppError, cursor pagination, slugs, tokens, shared zod schemas
  ledger/             ledger.service.js (the only code that moves money), audit.js
  integrations/       paystack.client.js (mock or live provider)
  mock-paystack/      Fake Paystack: provider, checkout routes, signed webhook sender
  events/             (later blocks)
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
