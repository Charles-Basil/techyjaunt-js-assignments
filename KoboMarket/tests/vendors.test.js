const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { bearer, bankDetails, createAdmin } = require('./helpers/marketplace');
const { User } = require('../src/modules/users/user.model');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

function apply(user, storeName = 'Ada Shoes') {
  return request(app)
    .post('/api/v1/vendors/apply')
    .set(bearer(user.accessToken))
    .send({ storeName, description: 'Handmade shoes', bankDetails: bankDetails() });
}

function decide(admin, applicationId, body) {
  return request(app)
    .patch(`/api/v1/admin/vendors/${applicationId}/approve`)
    .set(bearer(admin.accessToken))
    .send(body);
}

describe('vendor applications', () => {
  test('apply masks the account number and starts PENDING', async () => {
    const user = await registerAndLogin();
    const res = await apply(user);
    expect(res.status).toBe(201);
    expect(res.body.data.application.status).toBe('PENDING');
    expect(res.body.data.application.storeSlug).toBe('ada-shoes');
    expect(res.body.data.application.bankDetails.accountNumber).toBe('******6789');
  });

  test('a second application while PENDING is 409', async () => {
    const user = await registerAndLogin();
    await apply(user).expect(201);
    const res = await apply(user, 'Another Store');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('APPLICATION_EXISTS');
  });

  test('a taken store name is 409', async () => {
    await apply(await registerAndLogin(), 'Same Name').expect(201);
    const res = await apply(await registerAndLogin(), 'Same Name');
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('STORE_NAME_TAKEN');
  });

  test('approval adds the VENDOR role; the store becomes public without bank details', async () => {
    const admin = await createAdmin();
    const user = await registerAndLogin();
    const { body } = await apply(user);

    const res = await decide(admin, body.data.application.id, { decision: 'APPROVED' });
    expect(res.status).toBe(200);
    expect(res.body.data.application.status).toBe('APPROVED');

    const fresh = await User.findById(user.user.id);
    expect(fresh.roles).toEqual(expect.arrayContaining(['BUYER', 'VENDOR']));

    const store = await request(app).get(`/api/v1/vendors/${user.user.id}`).expect(200);
    expect(store.body.data.vendor.storeName).toBe('Ada Shoes');
    expect(store.body.data.vendor).not.toHaveProperty('bankDetails');
  });

  test('only a PENDING application can be decided', async () => {
    const admin = await createAdmin();
    const { body } = await apply(await registerAndLogin());
    await decide(admin, body.data.application.id, { decision: 'APPROVED' }).expect(200);
    const again = await decide(admin, body.data.application.id, { decision: 'REJECTED', reason: 'x' });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe('APPLICATION_ALREADY_DECIDED');
  });

  test('a REJECTED user may re-apply', async () => {
    const admin = await createAdmin();
    const user = await registerAndLogin();
    const { body } = await apply(user);
    await decide(admin, body.data.application.id, { decision: 'REJECTED', reason: 'Blurry ID' }).expect(200);

    const again = await apply(user, 'Better Store');
    expect(again.status).toBe(201);
    expect(again.body.data.application).toMatchObject({ status: 'PENDING', rejectionReason: null });
  });

  test('a pending store is not public, and non-admins cannot list applications', async () => {
    const user = await registerAndLogin();
    await apply(user).expect(201);
    await request(app).get(`/api/v1/vendors/${user.user.id}`).expect(404);
    await request(app).get('/api/v1/admin/vendors').set(bearer(user.accessToken)).expect(403);
  });

  test('admin list filters by status and pages with a cursor', async () => {
    const admin = await createAdmin();
    for (let i = 0; i < 3; i += 1) await apply(await registerAndLogin(), `Store ${i}`).expect(201);

    const page1 = await request(app)
      .get('/api/v1/admin/vendors?status=PENDING&limit=2')
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(page1.body.data).toHaveLength(2);
    expect(page1.body.pagination.hasMore).toBe(true);

    const page2 = await request(app)
      .get(`/api/v1/admin/vendors?status=PENDING&limit=2&cursor=${page1.body.pagination.nextCursor}`)
      .set(bearer(admin.accessToken))
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    expect(page2.body.pagination).toEqual({ nextCursor: null, hasMore: false, limit: 2 });
  });
});
