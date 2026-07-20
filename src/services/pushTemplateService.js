const PUSH_TEMPLATES = {
  trip_completed: {
    title: "Viaje completado 🎉",
    body: "Hola {{userName}}, tu viaje {{origin}} → {{destination}} ha finalizado. ¡Gracias por usar Carpooling!",
    data: {
      type: "trip_completed",
      tripId: "{{tripId}}",
    },
  },
  trip_started: {
    title: "El viaje ha comenzado 🚗",
    body: "Tu viaje {{origin}} → {{destination}} ha empezado. ¡Buen camino!",
    data: {
      type: "trip_started",
      tripId: "{{tripId}}",
    },
  },
  trip_booked: {
    title: "Nueva reserva en tu viaje 🧑‍🤝‍🧑",
    body: "{{passengerName}} ha reservado {{seatsBooked}} asiento(s) en tu viaje {{origin}} → {{destination}}.",
    data: {
      type: "trip_booked",
      tripId: "{{tripId}}",
      passengerName: "{{passengerName}}",
      seatsBooked: "{{seatsBooked}}",
    },
  },
};

function interpolate(text, data) {
  let result = text;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, String(value ?? ""));
  }
  return result;
}

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

function listPushTemplates() {
  return Object.keys(PUSH_TEMPLATES).map((name) => ({
    name,
    title: PUSH_TEMPLATES[name].title,
  }));
}

module.exports = {
  renderPushTemplate,
  listPushTemplates,
  PUSH_TEMPLATES,
};
