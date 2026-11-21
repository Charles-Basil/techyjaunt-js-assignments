const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const { updateMeBody } = require('./users.schemas');
const controller = require('./users.controller');

const router = express.Router();

router.get('/me', authenticate, controller.getMe);
router.patch('/me', authenticate, validate({ body: updateMeBody }), controller.updateMe);

module.exports = router;
