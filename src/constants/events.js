const { NOTIFICATION_TYPES } = require("./notifications");

/**
 * Eventos de dominio entrantes que escucha carpooling-notifications en `carpooling_events`.
 */
const INBOUND_EVENTS = {
  USER: {
    REGISTERED: "user.registered",
    PASSWORD_RESET_REQUESTED: "user.password_reset_requested",
  },
  SUGGESTION: {
    CREATED: "suggestion.created",
  },
  ENTERPRISE: {
    MEMBER_INVITED: "enterprise.member.invited",
  },
  TRIP: {
    ALERT_MATCHED: "trip.alert.matched",
    CONFIRMED: "trip.confirmed",
    BOOKED: "trip.booked",
    CANCELLED: "trip.cancelled",
    STARTED: "trip.started",
    COMPLETED: "trip.completed",
    BOOKING_REQUESTED: "trip.booking.requested",
  },
};

/**
 * Eventos / mensajes salientes publicados por carpooling-notifications:
 * - INTERNAL_JOBS: routing keys internos hacia colas de workers (carpooling_notifications / DLQ)
 * - TELEMETRY: contrato reservado de eventos de ciclo de vida para carpooling_events
 */
const OUTBOUND_EVENTS = {
  INTERNAL_JOBS: {
    PUSH_DIRECT: "push.direct",
    PUSH_BATCH: "push.batch",
    PUSH_TOPIC: "push.topic",
    PUSH_RETRY: "push.retry",
    EMAIL_TEMPLATE: "email.template",
    EMAIL_RAW: "email.raw",
    EMAIL_LOOKUP: "email.lookup",
    EMAIL_RETRY: "email.retry",
    DEAD_LETTER: "dead_letter",
  },
  TELEMETRY: {
    BATCH_QUEUED: "notification.batch.queued",
    DELIVERY_SUCCEEDED: "notification.delivery.succeeded",
    DELIVERY_FAILED: "notification.delivery.failed",
    TOKEN_DEACTIVATED: "notification.token.deactivated",
  },
};

/**
 * Mapa 1:1 desde cada evento de dominio entrante hacia su tipo en el catálogo de notificaciones.
 */
const EVENT_TO_NOTIFICATION_TYPE = {
  [INBOUND_EVENTS.USER.REGISTERED]: NOTIFICATION_TYPES.WELCOME,
  [INBOUND_EVENTS.USER.PASSWORD_RESET_REQUESTED]: NOTIFICATION_TYPES.PASSWORD_RESET,
  [INBOUND_EVENTS.SUGGESTION.CREATED]: NOTIFICATION_TYPES.SUGGESTION_RECEIVED,
  [INBOUND_EVENTS.ENTERPRISE.MEMBER_INVITED]: NOTIFICATION_TYPES.ENTERPRISE_INVITATION,
  [INBOUND_EVENTS.TRIP.ALERT_MATCHED]: NOTIFICATION_TYPES.TRIP_ALERT_MATCHED,
  [INBOUND_EVENTS.TRIP.CONFIRMED]: NOTIFICATION_TYPES.TRIP_CONFIRMATION,
  [INBOUND_EVENTS.TRIP.BOOKED]: NOTIFICATION_TYPES.TRIP_BOOKED,
  [INBOUND_EVENTS.TRIP.CANCELLED]: NOTIFICATION_TYPES.TRIP_CANCELLED,
  [INBOUND_EVENTS.TRIP.STARTED]: NOTIFICATION_TYPES.TRIP_STARTED,
  [INBOUND_EVENTS.TRIP.COMPLETED]: NOTIFICATION_TYPES.TRIP_COMPLETED,
  [INBOUND_EVENTS.TRIP.BOOKING_REQUESTED]: NOTIFICATION_TYPES.BOOKING_REQUEST,
};

const EVENT_SOURCES = {
  TRIPS: "carpooling-trips",
  USERS: "carpooling-user",
  ENTERPRISE: "carpooling-enterprise",
  NOTIFICATIONS: "carpooling-notifications",
};

module.exports = {
  INBOUND_EVENTS,
  OUTBOUND_EVENTS,
  EVENT_TO_NOTIFICATION_TYPE,
  EVENT_SOURCES,
};
