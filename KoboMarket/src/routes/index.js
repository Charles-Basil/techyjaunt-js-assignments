// Everything under /api/v1. Each module adds its own router here.
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, data: { name: 'KoboMarket API', version: 'v1' } });
});

router.use('/auth', require('../modules/auth/auth.routes'));
router.use('/users', require('../modules/users/users.routes'));
router.use('/admin', require('../modules/admin/admin.routes'));
router.use('/vendor', require('../modules/vendors/vendor.routes'));

module.exports = router;
