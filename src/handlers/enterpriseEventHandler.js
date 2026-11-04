const emailService = require("../services/emailService");
const templateService = require("../services/templateService");
const config = require("../config");

const HANDLER_NAME = "enterpriseEventHandler";

function getRoleTitle(role) {
  switch ((role || "").toUpperCase()) {
    case "ADMIN":
      return "Administrador de Organización";
    case "MANAGER":
      return "Gestor de Movilidad";
    case "EMPLOYEE":
    default:
      return "Empleado";
  }
}

function formatExpirationDate(expiresAt) {
  if (!expiresAt) return "7 días naturales";
  try {
    const date = new Date(expiresAt);
    if (isNaN(date.getTime())) return "7 días naturales";
    return date.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
  } catch (_e) {
    return "7 días naturales";
  }
}

async function handleEnterpriseMemberInvited(data) {
  const {
    enterprise_id,
    enterprise_name,
    email,
    role,
    department,
    employee_code,
    token,
    expires_at,
    invitation_link,
  } = data;

  if (!email || !enterprise_name) {
    console.warn(
      `[${HANDLER_NAME}] enterprise.member.invited: faltan campos obligatorios (email o enterprise_name)`,
    );
    return;
  }

  const roleTitle = getRoleTitle(role);
  const formattedExpiresAt = formatExpirationDate(expires_at);
  const finalInvitationLink =
    invitation_link ||
    `${(config.frontendUrl || "http://localhost:5173").replace(/\/$/, "")}/enterprise/invitation/accept?token=${token}`;

  const templateData = {
    enterpriseName: enterprise_name,
    recipientEmail: email,
    roleTitle,
    department: department || "General / Operaciones",
    employeeCode: employee_code || "Sin código",
    expiresAt: formattedExpiresAt,
    invitationLink: finalInvitationLink,
    frontendUrl: config.frontendUrl || "",
  };

  const { subject, html, text } = templateService.renderTemplate(
    "enterprise_invitation",
    templateData,
  );

  await emailService.sendEmail({
    to: email,
    subject,
    html,
    text,
  });

  console.log(
    `[${HANDLER_NAME}] Email de invitación enviado a ${email} para unirse a ${enterprise_name} con rol ${roleTitle} (enterprise_id=${enterprise_id})`,
  );
}

const EVENT_HANDLERS = {
  "enterprise.member.invited": handleEnterpriseMemberInvited,
};

async function handle(eventType, data) {
  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    console.warn(
      `[${HANDLER_NAME}] No hay handler registrado para el evento: ${eventType}`,
    );
    return;
  }

  await handler(data);
}

module.exports = {
  handle,
  EVENT_HANDLERS,
  handleEnterpriseMemberInvited,
  getRoleTitle,
  formatExpirationDate,
};
