const emailService = require("../services/emailService");
const templateService = require("../services/templateService");
const notificationQueue = require("../services/notificationQueue");
const config = require("../config");
const { INBOUND_EVENTS, EMAIL_TEMPLATES } = require("../constants");

const HANDLER_NAME = "userEventHandler";

async function dispatchUserEmail(email, template, templateData) {
  if (notificationQueue.isRabbitMQConnected()) {
    await notificationQueue.enqueueEmail({
      to: email,
      template,
      data: templateData,
    });
    return;
  }

  const { subject, html, text } = templateService.renderTemplate(
    template,
    templateData,
  );
  await emailService.sendEmail({
    to: email,
    subject,
    html,
    text,
  });
}

async function handleUserRegistered(data) {
  const { user_id, email, auth_method, role } = data;

  if (!email) {
    console.warn(`[${HANDLER_NAME}] ${INBOUND_EVENTS.USER.REGISTERED}: falta campo email`);
    return;
  }

  const templateData = {
    name: data.name || email.split("@")[0],
    frontendUrl: config.frontendUrl || "",
  };

  await dispatchUserEmail(email, EMAIL_TEMPLATES.WELCOME, templateData);

  console.log(
    `[${HANDLER_NAME}] Email de bienvenida procesado para ${email} (user_id=${user_id}, auth=${auth_method}, role=${role})`,
  );
}

async function handlePasswordResetRequested(data) {
  const { email, name, token, resetUrl, reset_url } = data;

  if (!email) {
    console.warn(
      `[${HANDLER_NAME}] ${INBOUND_EVENTS.USER.PASSWORD_RESET_REQUESTED}: falta campo email`,
    );
    return;
  }

  const finalResetUrl =
    resetUrl ||
    reset_url ||
    (token
      ? `${(config.frontendUrl || "http://localhost:5173").replace(/\/$/, "")}/reset-password?token=${token}`
      : "");

  if (!finalResetUrl) {
    console.warn(
      `[${HANDLER_NAME}] ${INBOUND_EVENTS.USER.PASSWORD_RESET_REQUESTED}: falta resetUrl o token`,
    );
    return;
  }

  const templateData = {
    name: name || email.split("@")[0],
    resetUrl: finalResetUrl,
    frontendUrl: config.frontendUrl || "",
  };

  await dispatchUserEmail(email, EMAIL_TEMPLATES.PASSWORD_RESET, templateData);

  console.log(
    `[${HANDLER_NAME}] Email de restablecimiento de contraseña procesado para ${email}`,
  );
}

const EVENT_HANDLERS = {
  [INBOUND_EVENTS.USER.REGISTERED]: handleUserRegistered,
  [INBOUND_EVENTS.USER.PASSWORD_RESET_REQUESTED]: handlePasswordResetRequested,
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

module.exports = {
  handle,
  EVENT_HANDLERS,
  handleUserRegistered,
  handlePasswordResetRequested,
};
