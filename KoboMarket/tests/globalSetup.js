// Runs ONCE before all test files (configured in package.json "jest.globalSetup").
// 1. Makes sure we are pointed at *_test databases (never wipe dev data by mistake).
// 2. Creates the kobomarket_test Postgres database if it doesn't exist yet.
// 3. Runs all Knex migrations on it.
const { Client } = require('pg');
const knexLib = require('knex');

module.exports = async function globalSetup() {
  process.env.NODE_ENV = 'test'; // so env.js loads .env.test
  const env = require('../src/config/env');
  const knexConfig = require('../knexfile');

  if (!env.PG_DATABASE.endsWith('_test') || !env.MONGO_URI.includes('_test')) {
    throw new Error('Refusing to run tests: PG_DATABASE and MONGO_URI must point at *_test databases');
  }

  // Connect to the built-in "postgres" database to create ours.
  const admin = new Client({
    host: env.PG_HOST,
    port: env.PG_PORT,
    user: env.PG_USER,
    password: env.PG_PASSWORD,
    database: 'postgres',
  });
  await admin.connect();
  const { rowCount } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [env.PG_DATABASE]);
  if (rowCount === 0) {
    // CREATE DATABASE can't take a $1 parameter; the name is checked above to end in _test.
    await admin.query(`CREATE DATABASE "${env.PG_DATABASE}"`);
  }
  await admin.end();

  const knex = knexLib(knexConfig);
  await knex.migrate.latest();
  await knex.destroy();
};
