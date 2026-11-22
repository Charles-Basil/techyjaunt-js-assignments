// /api/v1/notifications (always the caller's own notifications)
const express = require('express');
const { authenticate } = require('../../middlewares/auth');
const validate = require('../../middlewares/validate');
const schemas = require('./notifications.schemas');
const controller = require('./notifications.controller');

const router = express.Router();
router.use(authenticate);

router.get('/', validate({ query: schemas.listQuery }), controller.list);
router.get('/unread-count', controller.unreadCount);
// read-all is declared before /:id/read so "read-all" is never taken for an id.
router.patch('/read-all', controller.markAllRead);
router.patch('/:id/read', validate({ params: schemas.idParam }), controller.markRead);

module.exports = router;
