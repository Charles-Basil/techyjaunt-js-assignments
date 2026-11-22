const { z } = require('zod');
const { objectId, limit, cursor } = require('../../utils/schemas');

const listQuery = z.object({
  // Query strings are text: "true" -> true, anything else ("false", missing) -> false.
  unread: z
    .enum(['true', 'false'])
    .optional()
    .transform((v) => v === 'true'),
  limit,
  cursor,
});

const idParam = z.object({ id: objectId });

module.exports = { listQuery, idParam };
