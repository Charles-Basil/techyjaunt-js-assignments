const { z } = require('zod');
const { name, phone } = require('../auth/auth.schemas');

// Whitelist: ONLY these fields can be changed. .strict() makes any other field
// (roles, status, email, walletStatus...) a 400 error instead of silently saving it.
const updateMeBody = z
  .object({
    firstName: name.optional(),
    lastName: name.optional(),
    phone: phone.optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update');

module.exports = { updateMeBody };
