/**
 * Constantes de infraestructura RabbitMQ (exchanges, colas, routing keys y reintentos).
 */

const EXCHANGES = {
  DOMAIN_EVENTS: "carpooling_events",
  NOTIFICATIONS: "carpooling_notifications",
  DLQ: "carpooling_notifications_dlq",
};

const EXCHANGE_TYPES = {
  TOPIC: "topic",
  DIRECT: "direct",
};

const QUEUES = {
  DOMAIN: {
    USER: "notifications.user.events",
    SUGGESTION: "notifications.suggestion.events",
    ENTERPRISE: "notifications.enterprise.events",
    TRIP: "notifications.trip.events",
  },
  DELIVERY: {
    PUSH: "notifications.push.jobs",
    EMAIL: "notifications.email.jobs",
  },
  DLQ: "notifications.dead_letter",
};

const ROUTING_KEYS = {
  DOMAIN_PATTERNS: {
    USER: "user.*",
    SUGGESTION: "suggestion.*",
    ENTERPRISE: "enterprise.*",
    TRIP: "trip.*",
  },
  DELIVERY_PATTERNS: {
    PUSH: "push.#",
    EMAIL: "email.#",
  },
  DLQ: "dead_letter",
};

const RETRY_POLICY = {
  MAX_ATTEMPTS: 3,
  RETRY_COUNT_HEADER: "x-retry-count",
  STEPS: [
    { suffix: "10s", ttlMs: 10000 },
    { suffix: "30s", ttlMs: 30000 },
    { suffix: "120s", ttlMs: 120000 },
  ],
};

function getRetryQueueName(channelType, attemptIndex) {
  const step =
    RETRY_POLICY.STEPS[
      Math.min(Math.max(0, Number(attemptIndex) || 0), RETRY_POLICY.STEPS.length - 1)
    ];
  return `notifications.${channelType}.retry.${step.suffix}`;
}

module.exports = {
  EXCHANGES,
  EXCHANGE_TYPES,
  QUEUES,
  ROUTING_KEYS,
  RETRY_POLICY,
  getRetryQueueName,
};
