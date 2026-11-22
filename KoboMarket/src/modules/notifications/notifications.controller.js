const notificationsService = require('./notifications.service');

async function list(req, res) {
  const { items, pagination } = await notificationsService.listMine(req.user._id, req.validated.query);
  res.json({ success: true, data: items, pagination });
}

async function unreadCount(req, res) {
  res.json({ success: true, data: { unread: await notificationsService.unreadCount(req.user._id) } });
}

async function markRead(req, res) {
  const notification = await notificationsService.markRead(req.user._id, req.params.id);
  res.json({ success: true, data: { notification } });
}

async function markAllRead(req, res) {
  res.json({ success: true, data: { modified: await notificationsService.markAllRead(req.user._id) } });
}

module.exports = { list, unreadCount, markRead, markAllRead };
