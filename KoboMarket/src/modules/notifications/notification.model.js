const mongoose = require('mongoose');

const TYPES = [
  'ORDER_PLACED',
  'ORDER_SHIPPED',
  'FUNDS_RELEASED',
  'DISPUTE_OPENED',
  'DISPUTE_RESOLVED',
  'PAYOUT_SUCCESS',
  'PAYOUT_FAILED',
];

const notificationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    type: { type: String, enum: TYPES, required: true },
    title: { type: String, required: true },
    message: { type: String, required: true },
    // Links back to what happened: orderId, subOrderId, payoutId, amountKobo...
    data: { type: mongoose.Schema.Types.Mixed, default: {} },
    // e.g. "ORDER_PLACED:<orderId>". Unique per user (index below): the same
    // event delivered twice can never create two notifications.
    dedupeKey: { type: String, required: true },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, createdAt: -1, _id: -1 }); // my list, newest first
notificationSchema.index({ userId: 1, readAt: 1 }); // unread count / unread filter
notificationSchema.index({ userId: 1, dedupeKey: 1 }, { unique: true });

notificationSchema.set('toJSON', {
  transform(doc, ret) {
    ret.id = ret._id.toString();
    delete ret._id;
    delete ret.__v;
    delete ret.dedupeKey; // internal
    return ret;
  },
});

const Notification = mongoose.model('Notification', notificationSchema);

module.exports = { Notification, TYPES };
