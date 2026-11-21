const request = require('supertest');
const db = require('./helpers/db');
const { app, register, registerAndLogin, uniqueEmail, PASSWORD } = require('./helpers/auth');
const mailer = require('../src/modules/notifications/mailer.service');
const { User } = require('../src/modules/users/user.model');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

describe('register', () => {
  test('returns 201 with the user and never exposes secrets', async () => {
    const { user } = await register();
    expect(user.email).toMatch(/@example\.com$/);
    expect(user.roles).toEqual(['BUYER']);
    expect(user.isEmailVerified).toBe(false);
    expect(user).not.toHaveProperty('passwordHash');
    expect(user).not.toHaveProperty('emailVerifyTokenHash');
  });

  test('rejects extra fields such as roles (no mass assignment)', async () => {
    const res = await request(app).post('/api/v1/auth/register').send({
      email: uniqueEmail(),
      password: PASSWORD,
      firstName: 'Ada',
      lastName: 'Obi',
      roles: ['ADMIN'],
    });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  test('rejects a weak password', async () => {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: uniqueEmail(), password: 'onlyletters', firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(400);
  });

  test('rejects a duplicate email with 409', async () => {
    const { user } = await register();
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: user.email.toUpperCase(), password: PASSWORD, firstName: 'A', lastName: 'B' });
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('EMAIL_TAKEN');
  });
});

describe('email verification and login', () => {
  // (a)
  test('a user cannot log in before verifying their email', async () => {
    const { user } = await register();
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'EMAIL_NOT_VERIFIED', message: expect.any(String), details: null },
    });
  });

  test('after verifying, login returns an access and refresh token', async () => {
    const { verifyToken, user } = await register();
    await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken }).expect(200);

    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toEqual(expect.any(String));
    expect(res.body.data.refreshToken).toEqual(expect.any(String));
  });

  test('a verify token works only once', async () => {
    const { verifyToken } = await register();
    await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken }).expect(200);
    const res = await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_TOKEN');
  });

  test('a frozen user cannot log in', async () => {
    const { user, verifyToken } = await register();
    await request(app).post('/api/v1/auth/verify-email').send({ token: verifyToken }).expect(200);
    await User.updateOne({ email: user.email }, { status: 'FROZEN' });
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('ACCOUNT_FROZEN');
  });

  test('wrong password returns 401 INVALID_CREDENTIALS', async () => {
    const { user } = await registerAndLogin();
    const res = await request(app).post('/api/v1/auth/login').send({ email: user.email, password: 'Wrong12345' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
  });
});

describe('refresh token rotation', () => {
  // (b)
  test('rotation works, and reusing an old token kills the newer one too', async () => {
    const { refreshToken: first } = await registerAndLogin();

    // Normal rotation: first -> second
    const rotated = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(rotated.status).toBe(200);
    const second = rotated.body.data.refreshToken;
    expect(second).not.toBe(first);

    // Someone replays the OLD token -> reuse detected
    const reuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: first });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe('TOKEN_REUSE_DETECTED');

    // The newer token was revoked as part of the response to the reuse
    const afterReuse = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: second });
    expect(afterReuse.status).toBe(401);
  });

  test('an unknown refresh token returns 401', async () => {
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken: 'not-a-real-token' });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('INVALID_REFRESH_TOKEN');
  });

  test('logout revokes the refresh token and always returns 200', async () => {
    const { refreshToken } = await registerAndLogin();
    await request(app).post('/api/v1/auth/logout').send({ refreshToken }).expect(200);
    await request(app).post('/api/v1/auth/logout').send({ refreshToken: 'unknown' }).expect(200);
    const res = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(res.status).toBe(401);
  });
});

describe('password reset', () => {
  test('forgot-password returns 200 for unknown emails too', async () => {
    const res = await request(app).post('/api/v1/auth/forgot-password').send({ email: 'nobody@example.com' });
    expect(res.status).toBe(200);
  });

  test('reset changes the password and revokes all refresh tokens', async () => {
    const { user, refreshToken } = await registerAndLogin();

    const spy = jest.spyOn(mailer, 'sendPasswordResetEmail');
    await request(app).post('/api/v1/auth/forgot-password').send({ email: user.email }).expect(200);
    const resetToken = spy.mock.calls[0][0].token;
    spy.mockRestore();

    await request(app)
      .post('/api/v1/auth/reset-password')
      .send({ token: resetToken, newPassword: 'NewPassword456' })
      .expect(200);

    // Old session is dead
    const refreshed = await request(app).post('/api/v1/auth/refresh').send({ refreshToken });
    expect(refreshed.status).toBe(401);
    // Old password fails, new one works
    await request(app).post('/api/v1/auth/login').send({ email: user.email, password: PASSWORD }).expect(401);
    await request(app)
      .post('/api/v1/auth/login')
      .send({ email: user.email, password: 'NewPassword456' })
      .expect(200);
  });
});

describe('login rate limit', () => {
  // (e)
  test('the 6th failed login inside the window returns 429', async () => {
    const email = uniqueEmail();
    for (let i = 1; i <= 5; i += 1) {
      const res = await request(app).post('/api/v1/auth/login').send({ email, password: 'Wrong12345' });
      expect(res.status).toBe(401);
    }
    const sixth = await request(app).post('/api/v1/auth/login').send({ email, password: 'Wrong12345' });
    expect(sixth.status).toBe(429);
    expect(sixth.body.error.code).toBe('TOO_MANY_ATTEMPTS');
  });
});
