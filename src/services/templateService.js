const fs = require("fs");
const path = require("path");

const TEMPLATES_DIR = path.join(__dirname, "../templates");

const TEMPLATES = {
  welcome: {
    subject: "Bienvenido a Carpooling",
    file: "welcome.html",
  },
  trip_confirmation: {
    subject: "Confirmación de tu viaje - Carpooling",
    file: "trip-confirmation.html",
  },
  trip_cancelled: {
    subject: "Viaje cancelado - Carpooling",
    file: "trip-cancelled.html",
  },
  booking_request: {
    subject: "Nueva solicitud de reserva - Carpooling",
    file: "booking-request.html",
  },
  password_reset: {
    subject: "Restablece tu contraseña - Carpooling",
    file: "password-reset.html",
  },
};

function loadTemplateFile(filename) {
  const filePath = path.join(TEMPLATES_DIR, filename);
  return fs.readFileSync(filePath, "utf-8");
}

function interpolate(html, data) {
  let result = html;
  for (const [key, value] of Object.entries(data)) {
    const regex = new RegExp(`{{\\s*${key}\\s*}}`, "g");
    result = result.replace(regex, String(value ?? ""));
  }
  return result;
}

function htmlToText(html) {
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderTemplate(templateName, data = {}) {
  const template = TEMPLATES[templateName];
  if (!template) {
    const available = Object.keys(TEMPLATES).join(", ");
    throw new Error(`Template "${templateName}" not found. Available: ${available}`);
  }

  const rawHtml = loadTemplateFile(template.file);
  const html = interpolate(rawHtml, { ...data, frontendUrl: data.frontendUrl || "" });
  const text = htmlToText(html);

  return {
    subject: interpolate(template.subject, data),
    html,
    text,
  };
}

function listTemplates() {
  return Object.keys(TEMPLATES).map((name) => ({
    name,
    subject: TEMPLATES[name].subject,
  }));
}

module.exports = {
  renderTemplate,
  listTemplates,
};
