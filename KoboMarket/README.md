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
| `npm run audit:ledger`     | Ledger consistency check (placeholder for now)|

## Project structure

```
src/
  app.js              Express app (middleware, routes, error handling)
  server.js           Connects DBs, starts HTTP, graceful shutdown
  config/             env (zod-validated), logger (pino), mongo, knex
  middlewares/        requestId, errorHandler, notFound, validate, auth, rbac, notFrozen, idempotency*
  routes/             /health and the /api/v1 router
  modules/            One folder per feature (routes -> controllers -> services -> repositories)
  jobs/               Background jobs (walletReconciler.job.js)
  utils/              AppError, cursor pagination, slugs, tokens, shared zod schemas
  ledger/ events/ mock-paystack/
db/migrations/        Knex migrations (Postgres)
db/seeds/             Knex seeds
docs/openapi.yaml     API documentation served at /api-docs
scripts/              CLI scripts (ledger audit)
tests/                Jest + supertest
```

`*` = idempotency is still a stub (passes requests through).

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
