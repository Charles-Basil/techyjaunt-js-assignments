const AppError = require('../../utils/AppError');
const pagination = require('../../utils/pagination');
const notificationRepository = require('./notification.repository');

// Used by the event listener. `recipients` = user ids; each gets its own copy.
function notify(recipients, { type, title, message, data = {}, dedupeId }) {
  const unique = [...new Set(recipients.filter(Boolean).map(String))];
  return notificationRepository.createMany(
    unique.map((userId) => ({ userId, type, title, message, data, dedupeKey: `${type}:${dedupeId}` }))
  );
}

async function listMine(userId, { unread, limit, cursor }) {
  const extraFilter = cursor
    ? pagination.afterCursorFilter('createdAt', -1, pagination.decodeCursor(cursor, pagination.parseDate))
    : {};
  const docs = await notificationRepository.list(userId, {
    unreadOnly: unread,
    extraFilter,
    sort: pagination.sortSpec('createdAt', -1),
    limit: limit + 1,
  });
  return pagination.buildPage(docs, limit, 'createdAt');
}

function unreadCount(userId) {
  return notificationRepository.countUnread(userId);
}

async function markRead(userId, id) {
  const notification = await notificationRepository.markRead(userId, id);
  if (!notification) throw new AppError('NOT_FOUND', 'Notification not found', 404);
  return notification;
}

function markAllRead(userId) {
  return notificationRepository.markAllRead(userId);
}

module.exports = { notify, listMine, unreadCount, markRead, markAllRead };
