// Builds the Express app. It does NOT connect to databases or listen on a port
// (server.js does that), so tests can import the app directly with supertest.
const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const pinoHttp = require('pino-http');
const rateLimit = require('express-rate-limit');
const swaggerUi = require('swagger-ui-express');
const YAML = require('yamljs');

const env = require('./config/env');
const logger = require('./config/logger');
const requestId = require('./middlewares/requestId');
const notFound = require('./middlewares/notFound');
const errorHandler = require('./middlewares/errorHandler');
const AppError = require('./utils/AppError');
const healthRouter = require('./routes/health');
const apiRouter = require('./routes');
const webhookRouter = require('./modules/wallet/webhook.routes');
const { registerNotificationListeners } = require('./events/listeners/notification.listener');

// Subscribe event listeners once (the server and the tests both build the app here).
registerNotificationListeners();

const app = express();

// 1. Give every request an id first, so every log line below can include it.
app.use(requestId);
app.use(
  pinoHttp({
    logger,
    genReqId: (req) => req.id, // reuse the id from requestId middleware
    quietReqLogger: true, // req.log.* lines carry only { requestId }, not the whole request
    customAttributeKeys: { reqId: 'requestId' },
    customLogLevel: (req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
  })
);

// 2. Security headers. Outside production we drop "upgrade-insecure-requests"
//    so Swagger UI loads over plain http://localhost.
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: { upgradeInsecureRequests: env.isProduction ? [] : null },
    },
  })
);
app.use(cors({ origin: env.CORS_ORIGINS }));
app.use(
  express.json({
    limit: '1mb',
    // Keep the exact bytes of the body: webhook signatures are computed over
    // the raw bytes, and re-serialising req.body could change them.
    verify: (req, res, buf) => {
      req.rawBody = buf;
    },
  })
);

// 3. Routes
app.use('/health', healthRouter);
// Webhooks are mounted BEFORE the API rate limiter: Paystack must never be throttled.
app.use('/api/v1/webhooks', webhookRouter);
// The fake Paystack only exists in mock mode, and never in production.
if (env.PAYSTACK_MODE === 'mock' && env.NODE_ENV !== 'production') {
  app.use('/mock-paystack', require('./mock-paystack/mock.routes'));
}

const swaggerDoc = YAML.load(path.join(__dirname, '..', 'docs', 'openapi.yaml'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));

// Basic protection against request floods on the API (per IP).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  limit: 300,
  standardHeaders: 'draft-8',
  legacyHeaders: false,
  // Tests fire many requests quickly from one IP. The login limiter still runs in tests.
  skip: () => env.NODE_ENV === 'test',
  handler: (req, res, next) => next(new AppError('RATE_LIMITED', 'Too many requests, slow down', 429)),
});
app.use('/api/v1', apiLimiter, apiRouter);

// 4. Nothing matched -> 404, then every error goes through one handler.
app.use(notFound);
app.use(errorHandler);

module.exports = app;
