const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');

const router = express.Router();

// Every vendor route requires a logged-in VENDOR.
router.use(authenticate, requireRole('VENDOR'));

// Only exists to test RBAC.
router.get('/ping', (req, res) => {
  res.json({ success: true, data: { message: 'pong (vendor)' } });
});

module.exports = router;
