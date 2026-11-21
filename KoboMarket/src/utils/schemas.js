// Small zod building blocks shared by several modules.
const { z } = require('zod');

// A MongoDB ObjectId as a 24-character hex string.
const objectId = z.string().regex(/^[0-9a-fA-F]{24}$/, 'Invalid id');

// Money: whole kobo only. The max (NGN 100 million) keeps price * quantity far
// below Number.MAX_SAFE_INTEGER, so integer maths in JS stays exact.
const MAX_PRICE_KOBO = 10_000_000_000;
const priceKobo = z.number().int().positive().max(MAX_PRICE_KOBO);

// Query strings are always text, so numbers must be coerced: "10" -> 10.
const limit = z.coerce.number().int().min(1).max(50).default(20);
const cursor = z.string().min(1).max(500).optional();

// Validates route params like /products/:id
const idParam = z.object({ id: objectId });

module.exports = { objectId, priceKobo, MAX_PRICE_KOBO, limit, cursor, idParam };
