const { Notification } = require('./notification.model');

// Creates notifications, skipping any that already exist. Each one is an
// upsert keyed on { userId, dedupeKey } with $setOnInsert: if the event was
// already handled, nothing changes. One bulkWrite = one round trip for all recipients.
async function createMany(notifications) {
  if (notifications.length === 0) return 0;
  const result = await Notification.bulkWrite(
    notifications.map((n) => ({
      updateOne: {
        filter: { userId: n.userId, dedupeKey: n.dedupeKey },
        update: { $setOnInsert: n },
        upsert: true,
      },
    })),
    { ordered: false }
  );
  return result.upsertedCount;
}

function list(userId, { unreadOnly, extraFilter, sort, limit }) {
  const filter = { userId, ...extraFilter };
  if (unreadOnly) filter.readAt = null;
  return Notification.find(filter).sort(sort).limit(limit);
}

function countUnread(userId) {
  return Notification.countDocuments({ userId, readAt: null });
}

// The userId in the filter is the ownership check: another user's id matches nothing.
function markRead(userId, id) {
  return Notification.findOneAndUpdate(
    { _id: id, userId },
    [{ $set: { readAt: { $ifNull: ['$readAt', '$$NOW'] } } }], // keep the first read time
    { returnDocument: 'after', updatePipeline: true }
  );
}

async function markAllRead(userId) {
  const result = await Notification.updateMany({ userId, readAt: null }, { $set: { readAt: new Date() } });
  return result.modifiedCount;
}

module.exports = { createMany, list, countUnread, markRead, markAllRead };
