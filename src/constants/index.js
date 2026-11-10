const rabbitmq = require("./rabbitmq");
const notifications = require("./notifications");
const events = require("./events");

/**
 * Congela recursivamente objetos y arrays de constantes para prevenir mutaciones en runtime.
 */
function deepFreeze(target) {
  if (!target || typeof target !== "object") {
    return target;
  }

  Object.freeze(target);
  for (const key of Object.keys(target)) {
    deepFreeze(target[key]);
  }
  return target;
}

module.exports = {
  deepFreeze,
  EXCHANGES: deepFreeze(rabbitmq.EXCHANGES),
  EXCHANGE_TYPES: deepFreeze(rabbitmq.EXCHANGE_TYPES),
  QUEUES: deepFreeze(rabbitmq.QUEUES),
  ROUTING_KEYS: deepFreeze(rabbitmq.ROUTING_KEYS),
  RETRY_POLICY: deepFreeze(rabbitmq.RETRY_POLICY),
  getRetryQueueName: rabbitmq.getRetryQueueName,

  NOTIFICATION_TYPES: deepFreeze(notifications.NOTIFICATION_TYPES),
  NOTIFICATION_CHANNELS: deepFreeze(notifications.NOTIFICATION_CHANNELS),
  NOTIFICATION_PRIORITIES: deepFreeze(notifications.NOTIFICATION_PRIORITIES),
  JOB_KINDS: deepFreeze(notifications.JOB_KINDS),
  EMAIL_TEMPLATES: deepFreeze(notifications.EMAIL_TEMPLATES),
  PUSH_TEMPLATES: deepFreeze(notifications.PUSH_TEMPLATES),

  INBOUND_EVENTS: deepFreeze(events.INBOUND_EVENTS),
  OUTBOUND_EVENTS: deepFreeze(events.OUTBOUND_EVENTS),
  EVENT_TO_NOTIFICATION_TYPE: deepFreeze(events.EVENT_TO_NOTIFICATION_TYPE),
  EVENT_SOURCES: deepFreeze(events.EVENT_SOURCES),
};
