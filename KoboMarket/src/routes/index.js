// Everything under /api/v1. Each module (auth, products, wallet, ...) will add
// its own router here in later blocks, e.g.:
//   router.use('/auth', require('../modules/auth/auth.routes'));
const express = require('express');

const router = express.Router();

router.get('/', (req, res) => {
  res.json({ success: true, data: { name: 'KoboMarket API', version: 'v1' } });
});

module.exports = router;
