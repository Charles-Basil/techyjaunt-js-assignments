const router = require('express').Router();
const auth = require('../middleware/auth');
const { getProfile } = require('../controllers/userController');

// auth runs first; only valid tokens reach getProfile
router.get('/profile', auth, getProfile);

module.exports = router;