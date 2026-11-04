const emailService = require("../services/emailService");
const templateService = require("../services/templateService");
const notificationQueue = require("../services/notificationQueue");
const config = require("../config");
const { isValidEmail, sanitizeString } = require("../security");

const VALID_TEMPLATES = [
  "welcome",
  "trip_confirmation",
  "trip_cancelled",
  "booking_request",
  "password_reset",
  "suggestion_received",
  "trip_completed",
  "trip_started",
  "trip_booked",
  "enterprise_invitation",
];

const TEMPLATE_REQUIRED_FIELDS = {
  welcome: ["name"],
  trip_confirmation: [
    "userName",
    "origin",
    "destination",
    "date",
    "time",
    "seats",
    "price",
    "tripId",
  ],
  trip_cancelled: [
    "userName",
    "origin",
    "destination",
    "date",
    "time",
    "reason",
  ],
  booking_request: [
    "driverName",
    "passengerName",
    "origin",
    "destination",
    "date",
    "time",
    "seatsRequested",
    "tripId",
  ],
  password_reset: ["name", "resetUrl"],
  suggestion_received: [
    "companyName",
    "companyEmail",
    "userName",
    "userEmail",
    "adminUrl",
  ],
  trip_completed: [
    "userName",
    "origin",
    "destination",
    "date",
    "time",
    "passengers",
    "earnings",
    "tripId",
  ],
  trip_started: [
    "userName",
    "origin",
    "destination",
    "date",
    "time",
    "passengers",
    "tripId",
  ],
  trip_booked: [
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
  enterprise_invitation: ["enterpriseName", "roleTitle", "invitationLink"],
};

function validateTemplateFields(template, data) {
  const required = TEMPLATE_REQUIRED_FIELDS[template] || [];
  const missing = required.filter(
    (field) =>
      data[field] === undefined || data[field] === null || data[field] === "",
  );
  return missing;
}

/**
 * Envío de email basado en plantilla.
 * Soporta modo asíncrono no bloqueante (202 Accepted) para absorber concurrencia.
 */
async function sendTemplatedEmail(req, res, next) {
  try {
    const { to, template, data, cc, bcc, replyTo, sync } = req.body;

    if (!to) {
      return res.status(400).json({ error: "El campo 'to' es obligatorio" });
    }

    const recipients = Array.isArray(to) ? to : [to];
    for (const recipient of recipients) {
      if (!isValidEmail(recipient)) {
        return res
          .status(400)
          .json({ error: `El email destinatario '${recipient}' no es válido` });
      }
    }

    if (!template) {
      return res
        .status(400)
        .json({ error: "El campo 'template' es obligatorio" });
    }
    if (!VALID_TEMPLATES.includes(template)) {
      return res.status(400).json({
        error: `Template no válido. Disponibles: ${VALID_TEMPLATES.join(", ")}`,
      });
    }

    const missing = validateTemplateFields(template, data || {});
    if (missing.length > 0) {
      return res.status(400).json({
        error: `Faltan campos obligatorios para el template: ${missing.join(", ")}`,
      });
    }

    const templateData = { ...data, frontendUrl: config.frontendUrl };
    const emailPayload = {
      to,
      template,
      data: templateData,
      cc,
      bcc,
      replyTo,
    };

    if (sync === true || req.query.sync === "true") {
      const result = await emailService.sendTemplatedEmailDirect(emailPayload);
      return res.status(200).json({ success: true, ...result });
    }

    const queueResult = await notificationQueue.enqueueEmail(emailPayload);
    return res.status(202).json({
      success: true,
      message: "Email encolado satisfactoriamente para su envío.",
      template,
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío de email crudo (HTML o Texto).
 * Restringido a administradores o servicios internos para evitar spam / open relay.
 */
async function sendRawEmail(req, res, next) {
  try {
    const { to, subject, html, text, cc, bcc, replyTo, sync } = req.body;

    if (!to) {
      return res.status(400).json({ error: "El campo 'to' es obligatorio" });
    }

    const recipients = Array.isArray(to) ? to : [to];
    for (const recipient of recipients) {
      if (!isValidEmail(recipient)) {
        return res
          .status(400)
          .json({ error: `El email destinatario '${recipient}' no es válido` });
      }
    }

    if (!subject) {
      return res
        .status(400)
        .json({ error: "El campo 'subject' es obligatorio" });
    }
    if (!html && !text) {
      return res.status(400).json({ error: "Se requiere 'html' o 'text'" });
    }

    const emailPayload = {
      to,
      subject: sanitizeString(subject, 300),
      html,
      text,
      cc,
      bcc,
      replyTo,
    };

    if (sync === true || req.query.sync === "true") {
      const result = await emailService.sendEmailDirect(emailPayload);
      return res.status(200).json({ success: true, ...result });
    }

    const queueResult = await notificationQueue.enqueueEmail(emailPayload);
    return res.status(202).json({
      success: true,
      message: "Email encolado satisfactoriamente para su procesamiento.",
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío de sugerencia a la administración de YouConnext.
 */
async function sendSuggestionReceived(req, res, next) {
  try {
    const {
      companyName,
      companyEmail,
      website,
      userName,
      userEmail,
      suggestionId,
      sync,
    } = req.body;

    if (!config.adminEmail) {
      return res
        .status(500)
        .json({ error: "ADMIN_EMAIL no está configurada en el entorno" });
    }
    if (!config.adminSuggestionsUrl) {
      return res.status(500).json({
        error: "ADMIN_SUGGESTIONS_URL no está configurada en el entorno",
      });
    }
    if (!companyName) {
      return res
        .status(400)
        .json({ error: "El campo 'companyName' es obligatorio" });
    }
    if (!companyEmail || !isValidEmail(companyEmail)) {
      return res
        .status(400)
        .json({ error: "El email de la empresa no es válido o está ausente" });
    }
    if (!userName) {
      return res
        .status(400)
        .json({ error: "El campo 'userName' es obligatorio" });
    }
    if (!userEmail || !isValidEmail(userEmail)) {
      return res
        .status(400)
        .json({ error: "El campo 'userEmail' no es válido o está ausente" });
    }
    if (!suggestionId) {
      return res
        .status(400)
        .json({ error: "El campo 'suggestionId' es obligatorio" });
    }

    const finalAdminUrl = `${config.adminSuggestionsUrl.replace(/\/$/, "")}/${suggestionId}`;
    const templateData = {
      companyName: sanitizeString(companyName, 200),
      companyEmail,
      website: website ? sanitizeString(website, 200) : "",
      userName: sanitizeString(userName, 100),
      userEmail,
      suggestionId,
      adminUrl: finalAdminUrl,
      createdAt: new Date().toLocaleString("es-ES", {
        dateStyle: "medium",
        timeStyle: "short",
      }),
      frontendUrl: config.frontendUrl,
    };

    const emailPayload = {
      to: config.adminEmail,
      template: "suggestion_received",
      data: templateData,
    };

    if (sync === true || req.query.sync === "true") {
      const result = await emailService.sendTemplatedEmailDirect(emailPayload);
      return res.status(200).json({ success: true, to: config.adminEmail, ...result });
    }

    const queueResult = await notificationQueue.enqueueEmail(emailPayload);
    return res.status(202).json({
      success: true,
      message: "Notificación de sugerencia encolada para el administrador.",
      to: config.adminEmail,
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío de emails por lote (Batch).
 * Requiere rol administrador exclusivo o servicio interno (BFLA/Spam mitigation).
 */
async function sendBatchEmails(req, res, next) {
  try {
    const { emails, sync } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'emails' con al menos un elemento",
      });
    }

    for (const [i, email] of emails.entries()) {
      if (!email.to || !isValidEmail(email.to)) {
        return res
          .status(400)
          .json({ error: `Email en índice ${i}: 'to' es inválido o falta` });
      }
      if (!email.subject) {
        return res
          .status(400)
          .json({ error: `Email en índice ${i}: 'subject' es obligatorio` });
      }
      if (!email.html && !email.text) {
        return res
          .status(400)
          .json({ error: `Email en índice ${i}: se requiere 'html' o 'text'` });
      }
    }

    if (sync === true || req.query.sync === "true") {
      const results = await emailService.sendBatchEmailsDirect(emails);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return res.status(200).json({
        success: true,
        total: results.length,
        succeeded,
        failed,
        results,
      });
    }

    const queueResult = await notificationQueue.enqueueEmail({
      batch: true,
      emails,
    });

    return res.status(202).json({
      success: true,
      message: "Lote de correos encolado satisfactoriamente.",
      totalEmails: emails.length,
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

async function verifyConnection(req, res, next) {
  try {
    await emailService.verifyConnection();
    res.status(200).json({
      success: true,
      message: "Conexión SMTP verificada correctamente",
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: "No se pudo conectar al servidor SMTP",
      detail: error.message,
    });
  }
}

function listTemplates(req, res) {
  const templates = templateService.listTemplates();
  res.status(200).json({ templates });
}

module.exports = {
  sendTemplatedEmail,
  sendRawEmail,
  sendBatchEmails,
  sendSuggestionReceived,
  verifyConnection,
  listTemplates,
};
