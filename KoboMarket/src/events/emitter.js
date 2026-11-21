// In-process domain events: 'order.placed', 'order.shipped', 'order.cancelled',
// 'funds.released'. Listeners (notifications) come in the next block.
//
// emitEvent() is fire-and-forget: listeners run on a later tick, so the HTTP
// request never waits for them and a failing listener can never break checkout.
const { EventEmitter } = require('events');
const logger = require('../config/logger');

const emitter = new EventEmitter();

function emitEvent(name, payload) {
  setImmediate(() => {
    try {
      emitter.emit(name, payload);
    } catch (err) {
      logger.error({ err, event: name }, 'Event listener failed');
    }
  });
}

module.exports = { emitter, emitEvent };
