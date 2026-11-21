// pgcrypto gives us gen_random_uuid(), used as the default for every id column.
exports.up = (knex) => knex.raw('CREATE EXTENSION IF NOT EXISTS pgcrypto');

// Never drop the extension on rollback: other database objects may rely on it.
exports.down = () => Promise.resolve();
