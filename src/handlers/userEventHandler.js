const emailService = require("../services/emailService");
const templateService = require("../services/templateService");
const config = require("../config");

const HANDLER_NAME = "userEventHandler";

async function handleUserRegistered(data) {
  const { user_id, email, auth_method, role } = data;

  if (!email) {
    console.warn(`[${HANDLER_NAME}] user.registered: falta campo email`);
    return;
  }

  const { subject, html, text } = templateService.renderTemplate("welcome", {
    name: email.split("@")[0],
    frontendUrl: config.frontendUrl || "",
  });

  await emailService.sendEmail({
    to: email,
    subject,
    html,
    text,
  });

  console.log(
    `[${HANDLER_NAME}] Email de bienvenida enviado a ${email} (user_id=${user_id}, auth=${auth_method}, role=${role})`,
  );
}

const EVENT_HANDLERS = {
  "user.registered": handleUserRegistered,
};

async function handle(eventType, data) {
  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    console.warn(
      `[${HANDLER_NAME}] No hay handler para el evento: ${eventType}`,
    );
    return;
  }

  await handler(data);
}

module.exports = { handle, EVENT_HANDLERS };
