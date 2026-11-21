// Fake mailer: no real email is sent. In development the link is written to the
// logs so you can copy it (docker compose logs api).
//
// Tests replace these functions with jest.spyOn(mailer, 'sendVerificationEmail')
// to capture the token. That only works because callers use
// mailer.sendVerificationEmail(...) on this exported object.
//
// Exception to "never log tokens": the link IS the email body in this fake.
// In production we don't log it, because a real email provider would be used.
const env = require('../../config/env');
const logger = require('../../config/logger');

function deliver(to, subject, link) {
  if (env.isProduction) {
    logger.warn({ to, subject }, 'No email provider configured; email not sent');
    return;
  }
  logger.info({ to, subject, link }, 'EMAIL (dev mailer)');
}

const mailer = {
  async sendVerificationEmail({ to, token }) {
    deliver(to, 'Verify your KoboMarket email', `${env.APP_BASE_URL}/verify-email?token=${token}`);
  },

  async sendPasswordResetEmail({ to, token }) {
    deliver(to, 'Reset your KoboMarket password', `${env.APP_BASE_URL}/reset-password?token=${token}`);
  },
};

module.exports = mailer;
