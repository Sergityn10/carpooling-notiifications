const {
  NOTIFICATION_TYPES,
  NOTIFICATION_CHANNELS,
  EMAIL_TEMPLATES,
  PUSH_TEMPLATES,
} = require("../constants");

/**
 * Catálogo unificado de tipos de notificación de YouConnext.
 * Actúa como fuente única de verdad entre endpoints HTTP, eventos RabbitMQ,
 * plantillas HTML de email y plantillas Push FCM.
 */
const NOTIFICATION_CATALOG = {
  [NOTIFICATION_TYPES.TRIP_ALERT_MATCHED]: {
    description:
      "Alerta de nuevo trayecto publicado que coincide con búsquedas guardadas",
    channels: [NOTIFICATION_CHANNELS.PUSH, NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.TRIP_ALERT_MATCHED,
    pushTemplate: PUSH_TEMPLATES.TRIP_ALERT_MATCHED,
    requiredFields: ["tripId", "origin", "destination", "date", "time", "price"],
    sharedRequiredFields: [
      "tripId",
      "origin",
      "destination",
      "date",
      "time",
      "price",
    ],
    defaults: {
      seats: "-",
      driverName: "Conductor YouConnext",
    },
  },
  [NOTIFICATION_TYPES.WELCOME]: {
    description: "Bienvenida tras registro de usuario",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.WELCOME,
    pushTemplate: null,
    requiredFields: ["name"],
    defaults: {},
  },
  [NOTIFICATION_TYPES.TRIP_CONFIRMATION]: {
    description: "Confirmación de publicación o reserva de viaje",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.TRIP_CONFIRMATION,
    pushTemplate: null,
    requiredFields: [
      "userName",
      "origin",
      "destination",
      "date",
      "time",
      "seats",
      "price",
      "tripId",
    ],
    sharedRequiredFields: [
      "origin",
      "destination",
      "date",
      "time",
      "seats",
      "price",
      "tripId",
    ],
    defaults: {},
  },
  [NOTIFICATION_TYPES.TRIP_CANCELLED]: {
    description: "Aviso de cancelación de viaje",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.TRIP_CANCELLED,
    pushTemplate: null,
    requiredFields: [
      "userName",
      "origin",
      "destination",
      "date",
      "time",
      "reason",
    ],
    sharedRequiredFields: ["origin", "destination", "date", "time", "reason"],
    defaults: {},
  },
  [NOTIFICATION_TYPES.BOOKING_REQUEST]: {
    description: "Nueva solicitud de reserva recibida por el conductor",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.BOOKING_REQUEST,
    pushTemplate: null,
    requiredFields: [
      "driverName",
      "passengerName",
      "origin",
      "destination",
      "date",
      "time",
      "seatsRequested",
      "tripId",
    ],
    sharedRequiredFields: [
      "passengerName",
      "origin",
      "destination",
      "date",
      "time",
      "seatsRequested",
      "tripId",
    ],
    defaults: {},
  },
  [NOTIFICATION_TYPES.PASSWORD_RESET]: {
    description: "Restablecimiento de contraseña",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.PASSWORD_RESET,
    pushTemplate: null,
    requiredFields: ["name", "resetUrl"],
    defaults: {},
  },
  [NOTIFICATION_TYPES.SUGGESTION_RECEIVED]: {
    description: "Notificación interna de sugerencia de empresa",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.SUGGESTION_RECEIVED,
    pushTemplate: null,
    requiredFields: [
      "companyName",
      "companyEmail",
      "userName",
      "userEmail",
      "adminUrl",
    ],
    defaults: {},
  },
  [NOTIFICATION_TYPES.TRIP_COMPLETED]: {
    description: "Viaje finalizado",
    channels: [NOTIFICATION_CHANNELS.PUSH, NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.TRIP_COMPLETED,
    pushTemplate: PUSH_TEMPLATES.TRIP_COMPLETED,
    requiredFields: [
      "userName",
      "origin",
      "destination",
      "date",
      "time",
      "passengers",
      "earnings",
      "tripId",
    ],
    sharedRequiredFields: [
      "origin",
      "destination",
      "date",
      "time",
      "passengers",
      "earnings",
      "tripId",
    ],
    defaults: {},
  },
  [NOTIFICATION_TYPES.TRIP_STARTED]: {
    description: "El viaje ha comenzado",
    channels: [NOTIFICATION_CHANNELS.PUSH, NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.TRIP_STARTED,
    pushTemplate: PUSH_TEMPLATES.TRIP_STARTED,
    requiredFields: [
      "userName",
      "origin",
      "destination",
      "date",
      "time",
      "passengers",
      "tripId",
    ],
    sharedRequiredFields: [
      "origin",
      "destination",
      "date",
      "time",
      "passengers",
      "tripId",
    ],
    defaults: {},
  },
  [NOTIFICATION_TYPES.TRIP_BOOKED]: {
    description: "Nueva reserva confirmada en un viaje",
    channels: [NOTIFICATION_CHANNELS.PUSH, NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.TRIP_BOOKED,
    pushTemplate: PUSH_TEMPLATES.TRIP_BOOKED,
    requiredFields: [
      "userName",
      "passengerName",
      "origin",
      "destination",
      "date",
      "time",
      "seatsBooked",
      "seatsRemaining",
      "tripId",
    ],
    sharedRequiredFields: [
      "passengerName",
      "origin",
      "destination",
      "date",
      "time",
      "seatsBooked",
      "seatsRemaining",
      "tripId",
    ],
    defaults: {},
  },
  [NOTIFICATION_TYPES.ENTERPRISE_INVITATION]: {
    description: "Invitación para unirse a una organización en YouConnext",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.ENTERPRISE_INVITATION,
    pushTemplate: null,
    requiredFields: ["enterpriseName", "roleTitle", "invitationLink"],
    defaults: {},
  },
  [NOTIFICATION_TYPES.ADMIN_CUSTOM]: {
    description: "Comunicado o prueba personalizada enviada por administración",
    channels: [NOTIFICATION_CHANNELS.EMAIL],
    emailTemplate: EMAIL_TEMPLATES.ADMIN_CUSTOM,
    pushTemplate: null,
    requiredFields: ["subject", "title", "message"],
    defaults: {},
  },
};

function getNotificationType(type) {
  return NOTIFICATION_CATALOG[type] || null;
}

function validateCatalogFields(type, data = {}, { sharedOnly = false } = {}) {
  const entry = NOTIFICATION_CATALOG[type];
  if (!entry) return [];

  const fieldsToCheck =
    sharedOnly && Array.isArray(entry.sharedRequiredFields)
      ? entry.sharedRequiredFields
      : entry.requiredFields;

  return fieldsToCheck.filter(
    (field) =>
      data[field] === undefined || data[field] === null || data[field] === "",
  );
}

function listNotificationTypes() {
  return Object.entries(NOTIFICATION_CATALOG).map(([type, def]) => ({
    type,
    description: def.description,
    channels: def.channels,
    requiredFields: def.requiredFields,
    sharedRequiredFields: def.sharedRequiredFields || def.requiredFields,
    emailTemplate: def.emailTemplate,
    pushTemplate: def.pushTemplate,
  }));
}

module.exports = {
  NOTIFICATION_CATALOG,
  getNotificationType,
  validateCatalogFields,
  listNotificationTypes,
};
