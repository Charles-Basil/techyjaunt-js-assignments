// Used by both the app (src/config/knex.js) and the knex CLI (npm run migrate).
const env = require('./src/config/env');

module.exports = {
  client: 'pg',
  connection: {
    host: env.PG_HOST,
    port: env.PG_PORT,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    database: env.PG_DATABASE,
  },
  pool: { min: 0, max: 10 },
  // Give up after 5s if no connection can be obtained (e.g. Postgres is down).
  acquireConnectionTimeout: 5000,
  migrations: {
    directory: './db/migrations',
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: './db/seeds',
  },
};
