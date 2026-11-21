const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const { requireRole } = require('../../middlewares/rbac');

const router = express.Router();

// Every admin route requires a logged-in ADMIN.
router.use(authenticate, requireRole('ADMIN'));

// Only exists to test RBAC.
router.get('/ping', (req, res) => {
  res.json({ success: true, data: { message: 'pong (admin)' } });
});

module.exports = router;
