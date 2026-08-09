const emailService = require("../services/emailService");
const config = require("../config");

const HANDLER_NAME = "suggestionEventHandler";

async function handleSuggestionCreated(data) {
  const {
    suggestion_id,
    company_name,
    company_email,
    website,
    user_name,
    user_email,
  } = data;

  if (!config.adminEmail) {
    console.warn(`[${HANDLER_NAME}] ADMIN_EMAIL no configurada, se omite el email`);
    return;
  }
  if (!config.adminSuggestionsUrl) {
    console.warn(`[${HANDLER_NAME}] ADMIN_SUGGESTIONS_URL no configurada, se omite el email`);
    return;
  }
  if (!company_name || !company_email || !suggestion_id) {
    console.warn(
      `[${HANDLER_NAME}] suggestion.created: faltan campos obligatorios (company_name, company_email, suggestion_id)`,
    );
    return;
  }

  const finalAdminUrl = `${config.adminSuggestionsUrl.replace(/\/$/, "")}/${suggestion_id}`;

  const templateData = {
    companyName: company_name,
    companyEmail: company_email,
    website: website || "",
    userName: user_name || "",
    userEmail: user_email || "",
    suggestionId: String(suggestion_id),
    adminUrl: finalAdminUrl,
    createdAt: new Date().toLocaleString("es-ES", {
      dateStyle: "medium",
      timeStyle: "short",
    }),
    frontendUrl: config.frontendUrl,
  };

  const result = await emailService.sendTemplatedEmail({
    to: config.adminEmail,
    template: "suggestion_received",
    data: templateData,
  });

  console.log(
    `[${HANDLER_NAME}] Email de sugerencia enviado a ${config.adminEmail} (suggestion_id=${suggestion_id})`,
  );
}

const EVENT_HANDLERS = {
  "suggestion.created": handleSuggestionCreated,
};

async function handle(eventType, data) {
  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    console.warn(`[${HANDLER_NAME}] No hay handler para el evento: ${eventType}`);
    return;
  }

  await handler(data);
}

module.exports = { handle, EVENT_HANDLERS };
