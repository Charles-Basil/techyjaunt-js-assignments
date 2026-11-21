const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { bearer, createAdmin, createApprovedVendor, createProduct } = require('./helpers/marketplace');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

// Follows nextCursor until the last page; returns every product in order.
async function fetchAllPages(query) {
  const all = [];
  let cursor = null;
  let pages = 0;
  do {
    const url = `/api/v1/products?${query}${cursor ? `&cursor=${cursor}` : ''}`;
    const res = await request(app).get(url).expect(200);
    all.push(...res.body.data);
    cursor = res.body.pagination.nextCursor;
    pages += 1;
  } while (cursor && pages < 20);
  return { all, pages };
}

describe('product permissions', () => {
  test('a non-vendor gets 403 on POST /products', async () => {
    const buyer = await registerAndLogin();
    const res = await request(app)
      .post('/api/v1/products')
      .set(bearer(buyer.accessToken))
      .send({ name: 'X', priceKobo: 100, category: 'misc', stock: 1 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  test('vendor A cannot edit or delete vendor B’s product', async () => {
    const admin = await createAdmin();
    const vendorA = await createApprovedVendor(admin);
    const vendorB = await createApprovedVendor(admin);
    const productB = await createProduct(vendorB);

    const edit = await request(app)
      .patch(`/api/v1/products/${productB.id}`)
      .set(bearer(vendorA.accessToken))
      .send({ priceKobo: 1 });
    expect(edit.status).toBe(403);
    expect(edit.body.error.code).toBe('NOT_PRODUCT_OWNER');

    await request(app).delete(`/api/v1/products/${productB.id}`).set(bearer(vendorA.accessToken)).expect(403);
  });

  test('PATCH rejects protected fields (vendorId, slug, ratings, isDeleted)', async () => {
    const admin = await createAdmin();
    const vendor = await createApprovedVendor(admin);
    const product = await createProduct(vendor);
    for (const body of [{ vendorId: admin.user.id }, { slug: 'x' }, { ratingAvg: 5 }, { isDeleted: true }]) {
      const res = await request(app)
        .patch(`/api/v1/products/${product.id}`)
        .set(bearer(vendor.accessToken))
        .send(body);
      expect(res.status).toBe(400);
    }
  });

  test('the owner can update price and stock; prices must be whole kobo', async () => {
    const admin = await createAdmin();
    const vendor = await createApprovedVendor(admin);
    const product = await createProduct(vendor);

    const ok = await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set(bearer(vendor.accessToken))
      .send({ priceKobo: 2000000, stock: 3 });
    expect(ok.status).toBe(200);
    expect(ok.body.data.product).toMatchObject({ priceKobo: 2000000, stock: 3 });

    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set(bearer(vendor.accessToken))
      .send({ priceKobo: 10.5 })
      .expect(400);
  });
});

describe('soft delete', () => {
  test('a deleted product disappears from the listing and slug lookup', async () => {
    const admin = await createAdmin();
    const vendor = await createApprovedVendor(admin);
    const product = await createProduct(vendor);

    await request(app).get(`/api/v1/products/${product.slug}`).expect(200);
    await request(app).delete(`/api/v1/products/${product.id}`).set(bearer(vendor.accessToken)).expect(200);

    await request(app).get(`/api/v1/products/${product.slug}`).expect(404);
    const list = await request(app).get('/api/v1/products').expect(200);
    expect(list.body.data.map((p) => p.id)).not.toContain(product.id);
  });
});

describe('listing, filters and cursor pagination', () => {
  let vendor;

  beforeEach(async () => {
    const admin = await createAdmin();
    vendor = await createApprovedVendor(admin);
  });

  test('25 products, limit 10: every product exactly once, for every sort', async () => {
    // Only 3 distinct prices, so many products tie on price: this checks the
    // _id tie-breaker in the cursor condition.
    const created = [];
    for (let i = 0; i < 25; i += 1) {
      created.push(await createProduct(vendor, { name: `Item ${i}`, priceKobo: [1000, 2000, 3000][i % 3] }));
    }
    const expectedIds = created.map((p) => p.id).sort();

    for (const sort of ['newest', 'price_asc', 'price_desc', 'rating']) {
      const { all, pages } = await fetchAllPages(`sort=${sort}&limit=10`);
      expect(pages).toBe(3); // 10 + 10 + 5
      const ids = all.map((p) => p.id);
      expect(new Set(ids).size).toBe(25); // no duplicates
      expect([...ids].sort()).toEqual(expectedIds); // no gaps

      if (sort === 'price_asc') {
        const prices = all.map((p) => p.priceKobo);
        expect(prices).toEqual([...prices].sort((a, b) => a - b));
      }
    }
  });

  test('price range and category filters', async () => {
    await createProduct(vendor, { name: 'Cheap shoe', priceKobo: 50000, category: 'shoes' });
    await createProduct(vendor, { name: 'Mid shoe', priceKobo: 150000, category: 'shoes' });
    await createProduct(vendor, { name: 'Pricey shoe', priceKobo: 900000, category: 'shoes' });
    await createProduct(vendor, { name: 'Mid bag', priceKobo: 150000, category: 'Bags' }); // stored lowercase

    const range = await request(app).get('/api/v1/products?minPrice=100000&maxPrice=500000').expect(200);
    expect(range.body.data.map((p) => p.name).sort()).toEqual(['Mid bag', 'Mid shoe']);

    const shoes = await request(app).get('/api/v1/products?category=shoes&maxPrice=500000').expect(200);
    expect(shoes.body.data.map((p) => p.name).sort()).toEqual(['Cheap shoe', 'Mid shoe']);

    const bags = await request(app).get('/api/v1/products?category=BAGS').expect(200);
    expect(bags.body.data.map((p) => p.name)).toEqual(['Mid bag']);
  });

  test('text search with q', async () => {
    await createProduct(vendor, { name: 'Leather wallet', description: 'brown' });
    await createProduct(vendor, { name: 'Running shoes', description: 'light and fast' });
    const res = await request(app).get('/api/v1/products?q=wallet').expect(200);
    expect(res.body.data.map((p) => p.name)).toEqual(['Leather wallet']);
  });

  test('bad query values and bad cursors are 400', async () => {
    await request(app).get('/api/v1/products?limit=0').expect(400);
    await request(app).get('/api/v1/products?minPrice=500&maxPrice=100').expect(400);
    await request(app).get('/api/v1/products?sort=cheapest').expect(400);
    const bad = await request(app).get('/api/v1/products?cursor=not-a-cursor').expect(400);
    expect(bad.body.error.code).toBe('INVALID_CURSOR');
  });
});
