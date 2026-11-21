const request = require('supertest');
const db = require('./helpers/db');
const { app, registerAndLogin } = require('./helpers/auth');
const { bearer, createAdmin, createApprovedVendor, createProduct } = require('./helpers/marketplace');
const cartService = require('../src/modules/cart/cart.service');

beforeAll(db.connect);
beforeEach(db.clean);
afterAll(db.close);

describe('cart', () => {
  let vendor;
  let buyer;
  let product;

  const addItem = (body) =>
    request(app).post('/api/v1/cart/items').set(bearer(buyer.accessToken)).send(body);
  const getCart = () => request(app).get('/api/v1/cart').set(bearer(buyer.accessToken)).expect(200);

  beforeEach(async () => {
    const admin = await createAdmin();
    vendor = await createApprovedVendor(admin);
    buyer = await registerAndLogin();
    product = await createProduct(vendor, { priceKobo: 250000, stock: 5 });
  });

  test('cannot add more than stock', async () => {
    const res = await addItem({ productId: product.id, quantity: 6 });
    expect(res.status).toBe(409);
    expect(res.body.error).toMatchObject({ code: 'INSUFFICIENT_STOCK', details: { available: 5, requested: 6 } });
  });

  test('adding the same item twice merges the quantity (still capped by stock)', async () => {
    await addItem({ productId: product.id, quantity: 2 }).expect(201);
    const second = await addItem({ productId: product.id, quantity: 3 });
    expect(second.status).toBe(201);
    expect(second.body.data.items).toHaveLength(1);
    expect(second.body.data.items[0].quantity).toBe(5);
    expect(second.body.data.subtotalKobo).toBe(1250000);

    // 5 already in the cart, stock is 5: one more is too many
    await addItem({ productId: product.id, quantity: 1 }).expect(409);
  });

  test('GET /cart flags priceChanged after the vendor changes the price', async () => {
    await addItem({ productId: product.id, quantity: 2 }).expect(201);
    await request(app)
      .patch(`/api/v1/products/${product.id}`)
      .set(bearer(vendor.accessToken))
      .send({ priceKobo: 300000 })
      .expect(200);

    const { body } = await getCart();
    expect(body.data.items[0]).toMatchObject({
      priceKoboSnapshot: 250000,
      currentPriceKobo: 300000,
      priceChanged: true,
      outOfStock: false,
      unavailable: false,
    });
    expect(body.data.subtotalKobo).toBe(600000); // current price, not the snapshot
  });

  test('flags outOfStock and unavailable', async () => {
    const other = await createProduct(vendor, { name: 'Other', stock: 5 });
    await addItem({ productId: product.id, quantity: 3 }).expect(201);
    await addItem({ productId: other.id, quantity: 1 }).expect(201);

    await request(app).patch(`/api/v1/products/${product.id}`).set(bearer(vendor.accessToken)).send({ stock: 1 });
    await request(app).delete(`/api/v1/products/${other.id}`).set(bearer(vendor.accessToken));

    const { body } = await getCart();
    const [first, second] = body.data.items;
    expect(first).toMatchObject({ outOfStock: true, unavailable: false });
    expect(second).toMatchObject({ unavailable: true, lineTotalKobo: 0 });
  });

  test('variants: required when the product has them, and must exist', async () => {
    const shoe = await createProduct(vendor, {
      name: 'Boot',
      variants: [{ name: 'Size 42', sku: 'BOOT-42', attributes: { size: '42' }, priceKobo: 400000, stock: 2 }],
    });
    await addItem({ productId: shoe.id, quantity: 1 }).expect(400);
    await addItem({ productId: shoe.id, variantId: product.id, quantity: 1 }).expect(404);

    const ok = await addItem({ productId: shoe.id, variantId: shoe.variants[0]._id, quantity: 2 });
    expect(ok.status).toBe(201);
    expect(ok.body.data.items[0]).toMatchObject({ currentPriceKobo: 400000, name: 'Boot (Size 42)' });
  });

  test('PATCH re-validates stock, DELETE removes the item', async () => {
    const added = await addItem({ productId: product.id, quantity: 1 }).expect(201);
    const itemId = added.body.data.items[0].id;

    await request(app)
      .patch(`/api/v1/cart/items/${itemId}`)
      .set(bearer(buyer.accessToken))
      .send({ quantity: 6 })
      .expect(409);
    await request(app)
      .patch(`/api/v1/cart/items/${itemId}`)
      .set(bearer(buyer.accessToken))
      .send({ quantity: 4 })
      .expect(200);

    const removed = await request(app)
      .delete(`/api/v1/cart/items/${itemId}`)
      .set(bearer(buyer.accessToken))
      .expect(200);
    expect(removed.body.data.items).toHaveLength(0);
  });

  test('validateForCheckout returns totals, or CART_INVALID with every problem', async () => {
    await expect(cartService.validateForCheckout(buyer.user.id)).rejects.toMatchObject({ code: 'CART_EMPTY' });

    await addItem({ productId: product.id, quantity: 2 }).expect(201);
    const ok = await cartService.validateForCheckout(buyer.user.id);
    expect(ok).toMatchObject({ totalKobo: 500000, vendorIds: [vendor.user.id] });

    await request(app).patch(`/api/v1/products/${product.id}`).set(bearer(vendor.accessToken)).send({ stock: 1 });
    await expect(cartService.validateForCheckout(buyer.user.id)).rejects.toMatchObject({
      code: 'CART_INVALID',
      statusCode: 409,
      details: [expect.objectContaining({ reason: 'INSUFFICIENT_STOCK', requested: 2, available: 1 })],
    });
  });
});
