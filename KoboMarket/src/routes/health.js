const express = require('express');
const { checkMongo } = require('../config/mongo');
const { checkPostgres } = require('../config/knex');

const router = express.Router();

// GET /health -> 200 if both databases answer, 503 if either is down.
router.get('/', async (req, res) => {
  const [mongo, postgres] = await Promise.all([checkMongo(), checkPostgres()]);
  const healthy = mongo.status === 'OK' && postgres.status === 'OK';

  res.status(healthy ? 200 : 503).json({
    success: healthy,
    data: {
      status: healthy ? 'OK' : 'DEGRADED',
      uptimeSeconds: Math.round(process.uptime()),
      checks: { mongo, postgres },
    },
  });
});

module.exports = router;
