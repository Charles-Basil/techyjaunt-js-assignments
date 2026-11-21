const { z } = require('zod');
const { objectId, priceKobo, limit, cursor } = require('../../utils/schemas');

const stock = z.number().int().min(0).max(1_000_000);
const text = (max) => z.string().trim().min(1).max(max);

const variant = z
  .object({
    // Optional on update: send the existing variant _id to keep it (carts point
    // at variant ids). A variant without _id is treated as new.
    _id: objectId.optional(),
    name: text(100),
    sku: text(64),
    attributes: z
      .object({ size: text(30).optional(), colour: text(30).optional() })
      .strict()
      .optional(),
    priceKobo,
    stock,
  })
  .strict();

// Fields a vendor may set. Anything else (vendorId, slug, ratingAvg, ratingCount,
// isDeleted, deletedAt...) is rejected by .strict().
const fields = {
  name: text(120),
  description: z.string().trim().max(5000),
  priceKobo,
  category: text(50).toLowerCase(),
  images: z.array(z.url()).max(10),
  stock,
  variants: z.array(variant).max(50),
  tags: z.array(text(30).toLowerCase()).max(20),
};

const createBody = z
  .object({
    ...fields,
    description: fields.description.optional(),
    images: fields.images.optional(),
    variants: fields.variants.optional(),
    tags: fields.tags.optional(),
  })
  .strict();

const updateBody = z
  .object({
    name: fields.name.optional(),
    description: fields.description.optional(),
    priceKobo: fields.priceKobo.optional(),
    category: fields.category.optional(),
    images: fields.images.optional(),
    stock: fields.stock.optional(),
    variants: fields.variants.optional(),
    tags: fields.tags.optional(),
    isActive: z.boolean().optional(), // a vendor can hide a product temporarily
  })
  .strict()
  .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update');

const SORTS = ['newest', 'price_asc', 'price_desc', 'rating'];

// Everything in a query string arrives as text, so numbers use z.coerce.
const listQuery = z
  .object({
    q: z.string().trim().min(1).max(100).optional(),
    category: z.string().trim().toLowerCase().max(50).optional(),
    vendorId: objectId.optional(),
    minPrice: z.coerce.number().int().min(0).optional(),
    maxPrice: z.coerce.number().int().min(0).optional(),
    minRating: z.coerce.number().min(0).max(5).optional(),
    sort: z.enum(SORTS).default('newest'),
    limit,
    cursor,
  })
  .refine((qs) => qs.minPrice === undefined || qs.maxPrice === undefined || qs.minPrice <= qs.maxPrice, {
    message: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

const slugParam = z.object({ slug: z.string().trim().min(1).max(100) });

module.exports = { createBody, updateBody, listQuery, slugParam, SORTS };
