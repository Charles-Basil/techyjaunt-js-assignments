// Runs automatically after `npm test` (package.json "posttest"): the ledger
// audit against the TEST database. If the books don't balance, it exits with
// code 1, so `npm test` fails even when every individual test passed.
//
// NODE_ENV must be set BEFORE anything requires src/config/env.js, because
// that's when .env.test (instead of .env) is chosen.
process.env.NODE_ENV = 'test';
require('./audit-ledger');
