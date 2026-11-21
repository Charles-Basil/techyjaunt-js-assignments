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
- Each test file wipes users, refresh tokens and user wallets before every test.
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
  utils/AppError.js   Errors we throw on purpose
  modules/            One folder per feature (routes -> controllers -> services -> repositories)
  jobs/               Background jobs (walletReconciler.job.js)
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
