const fs = require("fs");
const path = require("path");
const { EMAIL_TEMPLATES } = require("../constants");
const { escapeHtml, interpolate } = require("../utils/templateInterpolator");

const TEMPLATES_DIR = path.join(__dirname, "../templates");

const TEMPLATES = {
  [EMAIL_TEMPLATES.WELCOME]: {
    subject: "Bienvenido a YouConnext",
    file: "welcome.html",
  },
  [EMAIL_TEMPLATES.TRIP_CONFIRMATION]: {
    subject: "Confirmación de tu viaje - YouConnext",
    file: "trip-confirmation.html",
  },
  [EMAIL_TEMPLATES.TRIP_CANCELLED]: {
    subject: "Viaje cancelado - YouConnext",
    file: "trip-cancelled.html",
  },
  [EMAIL_TEMPLATES.BOOKING_REQUEST]: {
    subject: "Nueva solicitud de reserva - YouConnext",
    file: "booking-request.html",
  },
  [EMAIL_TEMPLATES.PASSWORD_RESET]: {
    subject: "Restablece tu contraseña - YouConnext",
    file: "password-reset.html",
  },
  [EMAIL_TEMPLATES.SUGGESTION_RECEIVED]: {
    subject: "Nueva sugerencia de empresa - YouConnext",
    file: "suggestion-received.html",
  },
  [EMAIL_TEMPLATES.TRIP_COMPLETED]: {
    subject: "Tu viaje ha finalizado - YouConnext",
    file: "trip-completed.html",
  },
  [EMAIL_TEMPLATES.TRIP_STARTED]: {
    subject: "Tu viaje ha comenzado - YouConnext",
    file: "trip-started.html",
  },
  [EMAIL_TEMPLATES.TRIP_BOOKED]: {
    subject: "Nueva reserva en tu viaje - YouConnext",
    file: "trip-booked.html",
  },
  [EMAIL_TEMPLATES.TRIP_ALERT_MATCHED]: {
    subject: "Nuevo viaje disponible: {{origin}} → {{destination}} - YouConnext",
    file: "trip-alert-matched.html",
  },
  [EMAIL_TEMPLATES.ENTERPRISE_INVITATION]: {
    subject: "Invitación para unirte a {{enterpriseName}} en YouConnext",
    file: "enterprise-invitation.html",
  },
};

// Caché en memoria de plantillas HTML para evitar lectura síncrona de disco en envíos batch
const templateCache = new Map();

function loadTemplateFile(filename) {
  if (templateCache.has(filename)) {
    return templateCache.get(filename);
  }

  const filePath = path.join(TEMPLATES_DIR, filename);
  const content = fs.readFileSync(filePath, "utf-8");
  templateCache.set(filename, content);
  return content;
}

function clearTemplateCache() {
  templateCache.clear();
}

function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function renderTemplate(templateName, data = {}) {
  const template = TEMPLATES[templateName];
  if (!template) {
    const available = Object.keys(TEMPLATES).join(", ");
    throw new Error(
      `Template "${templateName}" not found. Available: ${available}`,
    );
  }

  const enrichedData = {
    ...data,
    frontendUrl: data.frontendUrl || "",
    greetingSuffix: data.userName ? `, ${data.userName}` : "",
  };

  const rawHtml = loadTemplateFile(template.file);
  const html = interpolate(rawHtml, enrichedData, { escapeForHtml: true });
  const text = htmlToText(html);

  return {
    subject: interpolate(template.subject, enrichedData, {
      escapeForHtml: false,
    }),
    html,
    text,
  };
}

function hasTemplate(templateName) {
  return Boolean(TEMPLATES[templateName]);
}

function listTemplates() {
  return Object.keys(TEMPLATES).map((name) => ({
    name,
    subject: TEMPLATES[name].subject,
  }));
}

module.exports = {
  TEMPLATES,
  renderTemplate,
  hasTemplate,
  listTemplates,
  clearTemplateCache,
  escapeHtml,
};
