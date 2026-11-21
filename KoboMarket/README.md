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

Docker exposes Postgres on host port **5433** (not 5432) so it doesn't clash
with a Postgres that may already be installed on your machine. `.env` already
uses `PG_PORT=5433`. Inside Docker, the API uses `postgres:5432` and `mongo:27017`.

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
  middlewares/        requestId, errorHandler, notFound, validate, auth*, rbac*, idempotency*
  routes/             /health and the /api/v1 router
  utils/AppError.js   Errors we throw on purpose
  modules/            One folder per feature (routes -> controllers -> services -> repositories)
  ledger/ jobs/ events/ mock-paystack/
db/migrations/        Knex migrations (Postgres)
db/seeds/             Knex seeds
docs/openapi.yaml     API documentation served at /api-docs
scripts/              CLI scripts (ledger audit)
tests/                Jest + supertest
```

`*` = stub for now (the auth stub rejects every request with 501).

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
