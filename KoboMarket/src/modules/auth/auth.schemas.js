const { z } = require('zod');

// "  Ada@Example.COM " -> "ada@example.com", then check it's a valid email.
const email = z.string().trim().toLowerCase().pipe(z.email('Invalid email address'));

// max 72: bcrypt ignores anything after 72 bytes, so longer passwords would
// give a false sense of security.
const password = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be at most 72 characters')
  .regex(/[A-Za-z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

const name = z.string().trim().min(1).max(50);
const phone = z.string().trim().regex(/^\+?[0-9]{7,15}$/, 'Invalid phone number');

// A token is the 64/128-character hex string we generated.
const token = z.string().trim().min(1).max(256);

// .strict() rejects unknown fields, so nobody can send { roles: ['ADMIN'] }.
const registerBody = z
  .object({ email, password, firstName: name, lastName: name, phone: phone.optional() })
  .strict();

const verifyEmailBody = z.object({ token });

// Login only checks the password is present: the strength rules apply when it is set.
const loginBody = z.object({ email, password: z.string().min(1).max(72) });

const refreshBody = z.object({ refreshToken: token });

const forgotPasswordBody = z.object({ email });

const resetPasswordBody = z.object({ token, newPassword: password });

module.exports = {
  password,
  name,
  phone,
  registerBody,
  verifyEmailBody,
  loginBody,
  refreshBody,
  forgotPasswordBody,
  resetPasswordBody,
};
