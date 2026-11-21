const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const {
  bearer,
  createAdmin,
  createApprovedVendor,
  createProduct,
  insertCompletedPurchase,
} = require('./helpers/marketplace');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

function review(user, productId, body) {
  return request(app).post(`/api/v1/products/${productId}/reviews`).set(bearer(user.accessToken)).send(body);
}

describe('reviews', () => {
  let vendor;
  let product;

  beforeEach(async () => {
    const admin = await createAdmin();
    vendor = await createApprovedVendor(admin);
    product = await createProduct(vendor);
  });

  test('a buyer without a completed order cannot review (403)', async () => {
    const buyer = await registerAndLogin();
    const res = await review(buyer, product.id, { rating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('NOT_ELIGIBLE_TO_REVIEW');
  });

  test('with a completed order: can review once, second is 409, ratingAvg updates', async () => {
    const buyer1 = await registerAndLogin();
    const buyer2 = await registerAndLogin();
    for (const buyer of [buyer1, buyer2]) {
      await insertCompletedPurchase({ buyerId: buyer.user.id, vendorId: vendor.user.id, productId: product.id });
    }

    const first = await review(buyer1, product.id, { rating: 5, comment: 'Great' });
    expect(first.status).toBe(201);

    const duplicate = await review(buyer1, product.id, { rating: 1 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe('ALREADY_REVIEWED');

    await review(buyer2, product.id, { rating: 2 }).expect(201);

    // (5 + 2) / 2 = 3.5; the duplicate attempt didn't count
    const fresh = await request(app).get(`/api/v1/products/${product.slug}`).expect(200);
    expect(fresh.body.data.product).toMatchObject({ ratingAvg: 3.5, ratingCount: 2 });
  });

  test('ratingAvg is rounded to 2 decimals', async () => {
    const ratings = [5, 4, 4]; // 13 / 3 = 4.333...
    for (const rating of ratings) {
      const buyer = await registerAndLogin();
      await insertCompletedPurchase({ buyerId: buyer.user.id, vendorId: vendor.user.id, productId: product.id });
      await review(buyer, product.id, { rating }).expect(201);
    }
    const fresh = await request(app).get(`/api/v1/products/${product.slug}`).expect(200);
    expect(fresh.body.data.product).toMatchObject({ ratingAvg: 4.33, ratingCount: 3 });
  });

  test('a SHIPPED (not completed) order is not enough', async () => {
    const buyer = await registerAndLogin();
    await insertCompletedPurchase({ buyerId: buyer.user.id, vendorId: vendor.user.id, productId: product.id });
    await db.knex('sub_orders').update({ status: 'SHIPPED' });
    await review(buyer, product.id, { rating: 4 }).expect(403);
  });

  test('rating must be an integer from 1 to 5', async () => {
    const buyer = await registerAndLogin();
    await review(buyer, product.id, { rating: 6 }).expect(400);
    await review(buyer, product.id, { rating: 4.5 }).expect(400);
  });

  test('GET reviews is public and cursor paginated', async () => {
    for (let i = 0; i < 3; i += 1) {
      const buyer = await registerAndLogin();
      await insertCompletedPurchase({ buyerId: buyer.user.id, vendorId: vendor.user.id, productId: product.id });
      await review(buyer, product.id, { rating: 4, comment: `Review ${i}` }).expect(201);
    }
    const page1 = await request(app).get(`/api/v1/products/${product.id}/reviews?limit=2`).expect(200);
    expect(page1.body.data).toHaveLength(2);
    const page2 = await request(app)
      .get(`/api/v1/products/${product.id}/reviews?limit=2&cursor=${page1.body.pagination.nextCursor}`)
      .expect(200);
    expect(page2.body.data).toHaveLength(1);
    const ids = [...page1.body.data, ...page2.body.data].map((r) => r.id);
    expect(new Set(ids).size).toBe(3);
  });
});
