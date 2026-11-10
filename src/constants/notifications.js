/**
 * Constantes funcionales de entrega de notificaciones:
 * tipos de catálogo, canales, prioridades, tipos de job y nombres de plantilla.
 */

const NOTIFICATION_TYPES = {
  TRIP_ALERT_MATCHED: "trip_alert_matched",
  TRIP_CONFIRMATION: "trip_confirmation",
  TRIP_BOOKED: "trip_booked",
  TRIP_CANCELLED: "trip_cancelled",
  TRIP_STARTED: "trip_started",
  TRIP_COMPLETED: "trip_completed",
  BOOKING_REQUEST: "booking_request",
  WELCOME: "welcome",
  PASSWORD_RESET: "password_reset",
  SUGGESTION_RECEIVED: "suggestion_received",
  ENTERPRISE_INVITATION: "enterprise_invitation",
};

const NOTIFICATION_CHANNELS = {
  PUSH: "push",
  EMAIL: "email",
};

const NOTIFICATION_PRIORITIES = {
  HIGH: "high",
  NORMAL: "normal",
};

const JOB_KINDS = {
  USERS_BATCH: "users_batch",
  USERS_LOOKUP_FANOUT: "users_lookup_fanout",
};

const EMAIL_TEMPLATES = {
  WELCOME: "welcome",
  TRIP_CONFIRMATION: "trip_confirmation",
  TRIP_CANCELLED: "trip_cancelled",
  BOOKING_REQUEST: "booking_request",
  PASSWORD_RESET: "password_reset",
  SUGGESTION_RECEIVED: "suggestion_received",
  TRIP_COMPLETED: "trip_completed",
  TRIP_STARTED: "trip_started",
  TRIP_BOOKED: "trip_booked",
  TRIP_ALERT_MATCHED: "trip_alert_matched",
  ENTERPRISE_INVITATION: "enterprise_invitation",
};

const PUSH_TEMPLATES = {
  TRIP_ALERT_MATCHED: "trip_alert_matched",
  TRIP_COMPLETED: "trip_completed",
  TRIP_STARTED: "trip_started",
  TRIP_BOOKED: "trip_booked",
};

module.exports = {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
  JOB_KINDS,
  EMAIL_TEMPLATES,
  PUSH_TEMPLATES,
};
