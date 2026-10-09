const router = require('express').Router();
const validate = require('../middleware/validate');
const { registerSchema, loginSchema } = require('../validators/authValidator');
const { register, login, verifyEmail } = require('../controllers/authController');

// validate() runs first, and only good data reaches the controller
router.post('/register', validate(registerSchema), register);
router.post('/login', validate(loginSchema), login);
router.get('/verify-email', verifyEmail);

module.exports = router;