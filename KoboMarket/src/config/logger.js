const pino = require('pino');
const env = require('./env');

// Fields that must never appear in logs.
const REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  'password',
  'token',
  'accessToken',
  'refreshToken',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
];

// Pretty, coloured logs only in development AND only if pino-pretty is installed
// (it is a devDependency, so it is missing inside the production Docker image).
function prettyTransport() {
  if (env.NODE_ENV !== 'development') return undefined;
  try {
    require.resolve('pino-pretty');
  } catch {
    return undefined;
  }
  return {
    target: 'pino-pretty',
    options: { colorize: true, translateTime: 'SYS:standard', ignore: 'pid,hostname' },
  };
}

const logger = pino({
  level: env.NODE_ENV === 'test' ? 'silent' : 'info',
  redact: { paths: REDACT_PATHS, censor: '[REDACTED]' },
  transport: prettyTransport(),
});

module.exports = logger;
