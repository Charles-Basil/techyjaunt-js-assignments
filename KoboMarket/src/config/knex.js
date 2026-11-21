// One shared Knex instance (with its connection pool) for the whole app.
// The config lives in knexfile.js so the app and the knex CLI use the same settings.
//
// NOTE: node-postgres returns BIGINT columns as strings (e.g. "150000"), not numbers.
// That is on purpose: JS numbers lose precision above 2^53. Money code must
// convert with BigInt(...) or validate before doing arithmetic.
const knexLib = require('knex');
const knexConfig = require('../../knexfile');
const logger = require('./logger');

const knex = knexLib(knexConfig);

async function connectPostgres() {
  // Knex connects lazily, so run a tiny query to prove the DB is reachable.
  await knex.raw('select 1');
  logger.info('PostgreSQL connected');
}

async function disconnectPostgres() {
  await knex.destroy();
  logger.info('PostgreSQL pool closed');
}

// Used by GET /health. Returns { status, latencyMs } and never throws.
async function checkPostgres() {
  const started = Date.now();
  try {
    await knex.raw('select 1');
    return { status: 'OK', latencyMs: Date.now() - started };
  } catch (err) {
    logger.error({ err }, 'PostgreSQL health check failed');
    return { status: 'DOWN', latencyMs: null };
  }
}

module.exports = { knex, connectPostgres, disconnectPostgres, checkPostgres };
