// STUB — the real version (built with the wallet/orders blocks) will:
//   1. read the Idempotency-Key header
//   2. look up (user_id, endpoint, key) in the idempotency_keys table
//   3. replay the saved response if the same request was already processed
//   4. reject the key if it is reused with a different request body
// For now it just passes the request through. No money endpoints exist yet.
function idempotency() {
  return (req, res, next) => next();
}

module.exports = { idempotency };
