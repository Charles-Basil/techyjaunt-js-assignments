// Helpers that drive the real HTTP endpoints, so tests follow the same path a client would.
const request = require('supertest');
const app = require('../../src/app');
const mailer = require('../../src/modules/notifications/mailer.service');

const PASSWORD = 'Password123';

let counter = 0;
function uniqueEmail() {
  counter += 1;
  return `user${Date.now()}${counter}@example.com`;
}

// Registers a user and returns { user, verifyToken }.
// The token is captured by spying on the mailer instead of reading logs.
async function register(overrides = {}) {
  const spy = jest.spyOn(mailer, 'sendVerificationEmail');
  const body = {
    email: uniqueEmail(),
    password: PASSWORD,
    firstName: 'Ada',
    lastName: 'Obi',
    ...overrides,
  };
  const res = await request(app).post('/api/v1/auth/register').send(body);
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${JSON.stringify(res.body)}`);
  const verifyToken = spy.mock.calls.at(-1)[0].token;
  spy.mockRestore();
  return { user: res.body.data.user, verifyToken, password: body.password };
}

// Registers + verifies + logs in. Returns { user, accessToken, refreshToken }.
async function registerAndLogin(overrides = {}) {
  const { user, verifyToken, password } = await register(overrides);
  await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken }).expect(200);
  const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password }).expect(200);
  return { user, ...res.body.data };
}

module.exports = { app, register, registerAndLogin, uniqueEmail, PASSWORD };
