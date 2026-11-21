const { v4: uuidv4 } = require('uuid');

// Only accept a client-supplied id if it is short and safe (letters, digits, - and _).
// This stops someone injecting huge or weird strings into our logs.
const SAFE_ID = /^[A-Za-z0-9_-]{1,100}$/;

function requestId(req, res, next) {
  const incoming = req.get('x-request-id');
  req.id = incoming && SAFE_ID.test(incoming) ? incoming : uuidv4();
  res.setHeader('x-request-id', req.id);
  next();
}

module.exports = requestId;
