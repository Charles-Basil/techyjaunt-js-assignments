// Idempotency-Key middleware: "do this at most once, and give me the same answer
// if I ask again". Clients send a unique Idempotency-Key header per action (e.g.
// one per "Fund wallet" click). Retries with the same key and body get the
// stored response instead of running the action again.
//
// Usage (after authenticate): router.post('/fund', authenticate, idempotency(), handler)
//
//   first request  -> row inserted -> handler runs -> response stored -> sent
//   same key+body  -> stored response replayed (header Idempotent-Replayed: true)
//   same key, other body -> 409 IDEMPOTENCY_KEY_REUSED
//   first one still running -> 409 REQUEST_IN_PROGRESS
//   handler failed with 5xx -> row deleted, so the client can retry safely
const crypto = require('crypto');
const AppError = require('../utils/AppError');
const logger = require('../config/logger');
const idempotencyRepository = require('../modules/idempotency/idempotency.repository');

const KEY_PATTERN = /^[A-Za-z0-9_-]{8,100}$/;

// JSON with object keys sorted, so { a: 1, b: 2 } and { b: 2, a: 1 } hash the same.
function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value ?? null);
}

function hashBody(body) {
  return crypto.createHash('sha256').update(stableStringify(body ?? {})).digest('hex');
}

function idempotency() {
  return async function idempotencyMiddleware(req, res, next) {
    const key = req.get('Idempotency-Key');
    if (!key) {
      return next(new AppError('IDEMPOTENCY_KEY_REQUIRED', 'The Idempotency-Key header is required', 400));
    }
    if (!KEY_PATTERN.test(key)) {
      return next(
        new AppError('INVALID_IDEMPOTENCY_KEY', 'Idempotency-Key must be 8-100 characters: letters, digits, - or _', 400)
      );
    }
    if (!req.user) return next(new AppError('UNAUTHORIZED', 'Authentication required', 401));

    // e.g. "POST /api/v1/wallet/fund". Keys are scoped per user AND per endpoint.
    const ids = { userId: String(req.user._id), endpoint: `${req.method} ${req.baseUrl}${req.route.path}`, key };
    const requestHash = hashBody(req.body);

    const inserted = await idempotencyRepository.tryInsert({ ...ids, requestHash });

    if (!inserted) {
      const existing = await idempotencyRepository.find(ids);
      // Deleted between our insert attempt and this read (a failed first try): just retry.
      if (!existing) return next(new AppError('REQUEST_IN_PROGRESS', 'Please retry this request', 409));
      if (existing.request_hash !== requestHash) {
        return next(
          new AppError('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was already used with a different request', 409)
        );
      }
      if (existing.response_status === null) {
        return next(new AppError('REQUEST_IN_PROGRESS', 'The original request is still being processed', 409));
      }
      res.set('Idempotent-Replayed', 'true');
      return res.status(existing.response_status).json(existing.response_body);
    }

    // First time: wrap res.json so the response is SAVED BEFORE it is sent. Then a
    // retry that arrives right after can't see a half-finished row. (Error
    // responses from errorHandler also go through res.json, so they're covered too.)
    const sendJson = res.json.bind(res);
    res.json = (body) => {
      res.json = sendJson; // unwrap: only the first call is stored
      const status = res.statusCode;
      const persist = status < 500
        ? idempotencyRepository.saveResponse(ids, status, body) // 2xx and 4xx: same request = same answer
        : idempotencyRepository.remove(ids); // 5xx: forget it, the client may retry

      persist
        .catch(async (err) => {
          // If we can't store the answer, remove the row rather than leave it
          // "in progress" forever (which would block every retry).
          logger.error({ err, endpoint: ids.endpoint }, 'Could not store idempotent response');
          await idempotencyRepository.remove(ids).catch(() => {});
        })
        .finally(() => {
          // Never let a send error become an unhandled rejection (server.js exits on those).
          try {
            sendJson(body);
          } catch (err) {
            logger.error({ err }, 'Could not send response');
          }
        });
      return res;
    };
    next();
  };
}

module.exports = { idempotency, hashBody, stableStringify };
