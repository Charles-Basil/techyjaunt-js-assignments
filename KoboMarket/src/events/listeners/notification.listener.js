// Turns domain events into in-app notifications.
//
// Rules for every handler:
//  - it runs on a later tick (setImmediate), so the HTTP request that emitted
//    the event has already been answered and is never slowed down or broken;
//  - it catches and logs its own errors (a failed notification never affects money);
//  - it is idempotent: dedupeKey makes a repeated event a no-op.
const logger = require('../../config/logger');
const { toKoboBigInt, toKoboNumber } = require('../../utils/money');
const { emitter } = require('../emitter');
const notificationsService = require('../../modules/notifications/notifications.service');
const userRepository = require('../../modules/users/user.repository');

// 250050 kobo -> "NGN 2,500.50". BigInt maths even for display (no float rounding).
function naira(kobo) {
  const amount = toKoboBigInt(kobo);
  return `NGN ${(amount / 100n).toLocaleString('en-NG')}.${(amount % 100n).toString().padStart(2, '0')}`;
}

const handlers = {
  'order.placed': async ({ orderId, buyerId, totalKobo, subOrders }) => {
    await notificationsService.notify([buyerId], {
      type: 'ORDER_PLACED',
      title: 'Order placed',
      message: `Your order of ${naira(totalKobo)} has been paid and is held in escrow.`,
      data: { orderId, amountKobo: toKoboNumber(totalKobo) },
      dedupeId: orderId,
    });
    // Each vendor hears about their own part of the order.
    for (const sub of subOrders) {
      await notificationsService.notify([sub.vendorId], {
        type: 'ORDER_PLACED',
        title: 'New order',
        message: 'You have a new paid order to ship.',
        data: { orderId, subOrderId: sub.id },
        dedupeId: sub.id,
      });
    }
  },

  'order.shipped': async ({ subOrderId, orderId, buyerId, trackingNumber }) => {
    await notificationsService.notify([buyerId], {
      type: 'ORDER_SHIPPED',
      title: 'Your order has shipped',
      message: trackingNumber ? `Tracking number: ${trackingNumber}` : 'Your order is on its way.',
      data: { orderId, subOrderId, trackingNumber },
      dedupeId: subOrderId,
    });
  },

  'funds.released': async ({ subOrderId, orderId, vendorId, vendorAmountKobo }) => {
    await notificationsService.notify([vendorId], {
      type: 'FUNDS_RELEASED',
      title: 'Payment released',
      message: `${naira(vendorAmountKobo)} has been added to your wallet.`,
      data: { orderId, subOrderId, amountKobo: vendorAmountKobo },
      dedupeId: subOrderId,
    });
  },

  'dispute.opened': async ({ disputeId, subOrderId, orderId, vendorId }) => {
    const adminIds = await userRepository.findAdminIds();
    await notificationsService.notify([vendorId, ...adminIds], {
      type: 'DISPUTE_OPENED',
      title: 'A dispute was opened',
      message: 'A buyer opened a dispute. The payment stays in escrow until it is resolved.',
      data: { disputeId, subOrderId, orderId },
      dedupeId: disputeId,
    });
  },

  'dispute.resolved': async ({ disputeId, subOrderId, buyerId, vendorId, resolution, refundKobo }) => {
    await notificationsService.notify([buyerId, vendorId], {
      type: 'DISPUTE_RESOLVED',
      title: 'Dispute resolved',
      message: `The dispute was resolved: ${resolution.replace('_', ' ').toLowerCase()}.`,
      data: { disputeId, subOrderId, resolution, amountKobo: refundKobo },
      dedupeId: disputeId,
    });
  },

  'payout.success': async ({ payoutId, vendorId, amountKobo }) => {
    await notificationsService.notify([vendorId], {
      type: 'PAYOUT_SUCCESS',
      title: 'Payout sent',
      message: `${naira(amountKobo)} has been sent to your bank account.`,
      data: { payoutId, amountKobo: toKoboNumber(amountKobo) },
      dedupeId: payoutId,
    });
  },

  'payout.failed': async ({ payoutId, vendorId, reason }) => {
    await notificationsService.notify([vendorId], {
      type: 'PAYOUT_FAILED',
      title: 'Payout failed',
      message: 'Your payout could not be completed. The money is back in your wallet.',
      data: { payoutId, reason },
      dedupeId: payoutId,
    });
  },
};

let registered = false;

// Called once when the app starts (app.js). Safe to call again: it won't double-subscribe.
function registerNotificationListeners() {
  if (registered) return;
  registered = true;
  for (const [event, handler] of Object.entries(handlers)) {
    emitter.on(event, (payload) => {
      setImmediate(() => {
        Promise.resolve()
          .then(() => handler(payload))
          .catch((err) => logger.error({ err, event }, 'Notification listener failed'));
      });
    });
  }
}

module.exports = { registerNotificationListeners, handlers };
