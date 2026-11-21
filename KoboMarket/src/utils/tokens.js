const crypto = require('crypto');

// A random, unguessable token (sent to the user, e.g. in an email link or as a refresh token).
// 32 bytes = 256 bits of randomness, returned as 64 hex characters.
function generateToken(bytes = 32) {
  return crypto.randomBytes(bytes).toString('hex');
}

// We only ever STORE the sha256 hash of a token. If the database leaks,
// the attacker gets hashes, which can't be turned back into usable tokens.
// (sha256 is fine here because the tokens are long and random. Passwords
// are different: they are short and guessable, so they use slow bcrypt.)
function hashToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

module.exports = { generateToken, hashToken };
