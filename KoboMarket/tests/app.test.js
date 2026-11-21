// Smoke tests for the foundation. They don't need the databases to be running:
// /health simply reports DOWN (503) when they aren't.
const request = require('supertest');
const app = require('../src/app');
const { knex } = require('../src/config/knex');

afterAll(async () => {
  await knex.destroy(); // close the pg pool so Jest can exit
});

describe('foundation', () => {
  test('GET /health reports each database', async () => {
    const res = await request(app).get('/health');
    expect([200, 503]).toContain(res.status);
    expect(res.body.data.checks.mongo.status).toMatch(/OK|DOWN/);
    expect(res.body.data.checks.postgres.status).toMatch(/OK|DOWN/);
  });

  test('echoes x-request-id or generates one', async () => {
    const res = await request(app).get('/api/v1').set('x-request-id', 'test-123');
    expect(res.headers['x-request-id']).toBe('test-123');

    const res2 = await request(app).get('/api/v1');
    expect(res2.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  test('unknown route returns the standard error shape', async () => {
    const res = await request(app).get('/api/v1/nope');
    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Route GET /api/v1/nope not found', details: null },
    });
  });

  test('invalid JSON returns 400 INVALID_JSON', async () => {
    const res = await request(app)
      .post('/api/v1')
      .set('content-type', 'application/json')
      .send('{bad json');
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('INVALID_JSON');
  });

  test('swagger UI is served', async () => {
    const res = await request(app).get('/api-docs/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('swagger');
  });
});
