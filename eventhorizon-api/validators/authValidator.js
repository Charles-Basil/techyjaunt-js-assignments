const Joi = require('joi');

// Password rules: at least 8 characters, letters and numbers only, with at least one of each
const password = Joi.string()
  .pattern(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{8,}$/)
  .required()
  .messages({
    'string.pattern.base':
      'Password must be at least 8 characters, letters and numbers only, with at least one of each',
  });

// What a user must send when registering
exports.registerSchema = Joi.object({
  name: Joi.string().min(2).max(50).required(),
  email: Joi.string().email().required(),
  password,
});

// What a user must send when logging in
exports.loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});