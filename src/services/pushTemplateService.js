const { PUSH_TEMPLATES: PUSH_TEMPLATE_NAMES } = require("../constants");
const { interpolate } = require("../utils/templateInterpolator");

const PUSH_TEMPLATES = {
  [PUSH_TEMPLATE_NAMES.TRIP_ALERT_MATCHED]: {
    title: "¡Nuevo viaje {{origin}} → {{destination}}! 🚗",
    body: "Sale el {{date}} a las {{time}} desde {{price}}. ¡Échale un vistazo antes de que se llene!",
    data: {
      type: PUSH_TEMPLATE_NAMES.TRIP_ALERT_MATCHED,
      tripId: "{{tripId}}",
    },
  },
  [PUSH_TEMPLATE_NAMES.TRIP_COMPLETED]: {
    title: "Viaje completado 🎉",
    body: "Hola {{userName}}, tu viaje {{origin}} → {{destination}} ha finalizado. ¡Gracias por usar YouConnext!",
    data: {
      type: PUSH_TEMPLATE_NAMES.TRIP_COMPLETED,
      tripId: "{{tripId}}",
    },
  },
  [PUSH_TEMPLATE_NAMES.TRIP_STARTED]: {
    title: "El viaje ha comenzado 🚗",
    body: "Tu viaje {{origin}} → {{destination}} ha empezado. ¡Buen camino!",
    data: {
      type: PUSH_TEMPLATE_NAMES.TRIP_STARTED,
      tripId: "{{tripId}}",
    },
  },
  [PUSH_TEMPLATE_NAMES.TRIP_BOOKED]: {
    title: "Nueva reserva en tu viaje 🧑‍🤝‍🧑",
    body: "{{passengerName}} ha reservado {{seatsBooked}} asiento(s) en tu viaje {{origin}} → {{destination}}.",
    data: {
      type: PUSH_TEMPLATE_NAMES.TRIP_BOOKED,
      tripId: "{{tripId}}",
      passengerName: "{{passengerName}}",
      seatsBooked: "{{seatsBooked}}",
    },
  },
};

function renderPushTemplate(templateName, data = {}) {
  const template = PUSH_TEMPLATES[templateName];
  if (!template) {
    const available = Object.keys(PUSH_TEMPLATES).join(", ");
    throw new Error(
      `Push template "${templateName}" not found. Available: ${available}`,
    );
  }

  const title = interpolate(template.title, data);
  const body = interpolate(template.body, data);

  const interpolatedData = {};
  for (const [key, value] of Object.entries(template.data)) {
    interpolatedData[key] = interpolate(value, data);
  }

  return { title, body, data: interpolatedData };
}

function hasPushTemplate(templateName) {
  return Boolean(PUSH_TEMPLATES[templateName]);
}

function listPushTemplates() {
  return Object.keys(PUSH_TEMPLATES).map((name) => ({
    name,
    title: PUSH_TEMPLATES[name].title,
  }));
}

module.exports = {
  renderPushTemplate,
  hasPushTemplate,
  listPushTemplates,
  PUSH_TEMPLATES,
};
