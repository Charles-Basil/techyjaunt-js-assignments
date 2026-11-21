const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { User } = require('../src/modules/users/user.model');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

const bearer = (token) => ({ Authorization: `Bearer ${token}` });

describe('GET/PATCH /users/me', () => {
  test('requires a valid access token', async () => {
    await request(app).get('/api/v1/users/me').expect(401);
    const res = await request(app).get('/api/v1/users/me').set(bearer('garbage'));
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  test('returns the logged-in user', async () => {
    const { user, accessToken } = await registerAndLogin();
    const res = await request(app).get('/api/v1/users/me').set(bearer(accessToken));
    expect(res.status).toBe(200);
    expect(res.body.data.user.id).toBe(user.id);
    expect(res.body.data.user).not.toHaveProperty('passwordHash');
  });

  test('updates allowed fields only', async () => {
    const { accessToken } = await registerAndLogin();
    const ok = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ firstName: 'Chioma', phone: '+2348012345678' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.user.firstName).toBe('Chioma');

    const sneaky = await request(app)
      .patch('/api/v1/users/me')
      .set(bearer(accessToken))
      .send({ roles: ['ADMIN'], status: 'ACTIVE' });
    expect(sneaky.status).toBe(400);
    expect(sneaky.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('RBAC', () => {
  // (c)
  test('a buyer gets 403 on /admin/ping and /vendor/ping', async () => {
    const { accessToken } = await registerAndLogin();

    const admin = await request(app).get('/api/v1/admin/ping').set(bearer(accessToken));
    expect(admin.status).toBe(403);
    expect(admin.body.error.code).toBe('FORBIDDEN');

    const vendor = await request(app).get('/api/v1/vendor/ping').set(bearer(accessToken));
    expect(vendor.status).toBe(403);
    expect(vendor.body.error.code).toBe('FORBIDDEN');
  });

  test('roles are read from the database on every request', async () => {
    const { user, accessToken } = await registerAndLogin();
    // Promote the user directly in Mongo; the SAME token now passes.
    await User.updateOne({ _id: user.id }, { roles: ['BUYER', 'ADMIN'] });
    await request(app).get('/api/v1/admin/ping').set(bearer(accessToken)).expect(200);
    await request(app).get('/api/v1/vendor/ping').set(bearer(accessToken)).expect(403);
  });

  test('no token on a protected route returns 401, not 403', async () => {
    await request(app).get('/api/v1/admin/ping').expect(401);
  });
});
