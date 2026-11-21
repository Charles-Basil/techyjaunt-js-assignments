const express = require('express');
const validate = require('../../middlewares/validate');
const loginLimiter = require('./loginLimiter');
const schemas = require('./auth.schemas');
const controller = require('./auth.controller');

const router = express.Router();

router.post('/register', validate({ body: schemas.registerBody }), controller.register);
router.post('/verify-email', validate({ body: schemas.verifyEmailBody }), controller.verifyEmail);
// The limiter runs BEFORE validation so even malformed attempts are counted.
router.post('/login', loginLimiter, validate({ body: schemas.loginBody }), controller.login);
router.post('/refresh', validate({ body: schemas.refreshBody }), controller.refresh);
router.post('/logout', validate({ body: schemas.refreshBody }), controller.logout);
router.post('/forgot-password', validate({ body: schemas.forgotPasswordBody }), controller.forgotPassword);
router.post('/reset-password', validate({ body: schemas.resetPasswordBody }), controller.resetPassword);

module.exports = router;
