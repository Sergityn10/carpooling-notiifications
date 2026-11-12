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
  [EMAIL_TEMPLATES.ADMIN_CUSTOM]: {
    subject: "{{subject}}",
    file: "admin-custom.html",
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

function buildSafeMessageHtml(message) {
  return escapeHtml(message || "").replace(/\r?\n/g, "<br />");
}

function isSafeHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function buildSafeCtaBlock(ctaText, ctaUrl) {
  if (!ctaText || !isSafeHttpUrl(ctaUrl)) return "";
  const safeText = escapeHtml(String(ctaText).trim());
  const safeHref = escapeHtml(String(ctaUrl).trim());
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 28px 0">
    <tr>
      <td align="center">
        <a href="${safeHref}" style="background-color: #2563eb; color: #ffffff; text-decoration: none; padding: 14px 32px; border-radius: 8px; font-size: 16px; display: inline-block; font-weight: bold;">${safeText}</a>
      </td>
    </tr>
  </table>`;
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

  let rawHtml = loadTemplateFile(template.file);

  if (templateName === EMAIL_TEMPLATES.ADMIN_CUSTOM) {
    const safeMessageHtml = buildSafeMessageHtml(enrichedData.message);
    const safeCtaBlock = buildSafeCtaBlock(
      enrichedData.ctaText,
      enrichedData.ctaUrl,
    );
    rawHtml = rawHtml
      .replace(/{{\s*messageHtml\s*}}/g, () => safeMessageHtml)
      .replace(/{{\s*ctaBlock\s*}}/g, () => safeCtaBlock);
  }

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
