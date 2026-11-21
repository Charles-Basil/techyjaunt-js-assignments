// Shared database helpers for test files.
const mongoose = require('mongoose');
const env = require('../../src/config/env');
const { knex } = require('../../src/config/knex');
const { User } = require('../../src/modules/users/user.model');
const { RefreshToken } = require('../../src/modules/auth/refreshToken.model');

async function connect() {
  await mongoose.connect(env.MONGO_URI, {
    serverSelectionTimeoutMS: 5000,
    // Jest-only workaround: the MongoDB driver (v7.8) loads Node's "os" module
    // with a dynamic import(), which Jest's CommonJS sandbox can't do. The
    // handshake then goes out empty and MongoDB rejects it ("Missing required
    // sub-document 'driver'"). Handing the driver "os" ourselves avoids that.
    // The real app (plain Node) doesn't need this.
    runtimeAdapters: { os: require('os') },
  });
  // Build indexes (e.g. unique email) before tests rely on them.
  await Promise.all([User.init(), RefreshToken.init()]);
}

// Wipe everything a test could have created. System accounts (from migrations) stay.
async function clean() {
  await Promise.all([User.deleteMany({}), RefreshToken.deleteMany({})]);
  await knex('accounts').where({ owner_type: 'USER' }).del();
}

async function close() {
  await mongoose.disconnect();
  await knex.destroy();
}

module.exports = { connect, clean, close, knex };
