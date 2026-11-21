const mongoose = require('mongoose');
const env = require('./env');
const logger = require('./logger');

async function connectMongo() {
  // Fail after 5s instead of hanging forever if Mongo is unreachable.
  await mongoose.connect(env.MONGO_URI, { serverSelectionTimeoutMS: 5000 });
  logger.info('MongoDB connected');
}

async function disconnectMongo() {
  await mongoose.disconnect();
  logger.info('MongoDB disconnected');
}

// Used by GET /health. Returns { status, latencyMs } and never throws.
async function checkMongo() {
  const started = Date.now();
  // readyState 1 = connected. Anything else means we are not usable right now.
  if (mongoose.connection.readyState !== 1) {
    return { status: 'DOWN', latencyMs: null };
  }
  try {
    await mongoose.connection.db.admin().ping();
    return { status: 'OK', latencyMs: Date.now() - started };
  } catch (err) {
    logger.error({ err }, 'MongoDB health check failed');
    return { status: 'DOWN', latencyMs: null };
  }
}

module.exports = { connectMongo, disconnectMongo, checkMongo };
