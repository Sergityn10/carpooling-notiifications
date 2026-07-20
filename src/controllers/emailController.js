const emailService = require("../services/emailService");
const templateService = require("../services/templateService");
const config = require("../config");

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
};

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateTemplateFields(template, data) {
  const required = TEMPLATE_REQUIRED_FIELDS[template] || [];
  const missing = required.filter(
    (field) =>
      data[field] === undefined || data[field] === null || data[field] === "",
  );
  return missing;
}

async function sendTemplatedEmail(req, res, next) {
  try {
    const { to, template, data, cc, bcc, replyTo } = req.body;

    if (!to)
      return res.status(400).json({ error: "El campo 'to' es obligatorio" });
    if (!Array.isArray(to) && !validateEmail(to)) {
      return res
        .status(400)
        .json({ error: "El email destinatario no es válido" });
    }
    if (!template)
      return res
        .status(400)
        .json({ error: "El campo 'template' es obligatorio" });
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
    const result = await emailService.sendTemplatedEmail({
      to,
      template,
      data: templateData,
      cc,
      bcc,
      replyTo,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function sendRawEmail(req, res, next) {
  try {
    const { to, subject, html, text, cc, bcc, replyTo } = req.body;

    if (!to)
      return res.status(400).json({ error: "El campo 'to' es obligatorio" });
    if (!Array.isArray(to) && !validateEmail(to)) {
      return res
        .status(400)
        .json({ error: "El email destinatario no es válido" });
    }
    if (!subject)
      return res
        .status(400)
        .json({ error: "El campo 'subject' es obligatorio" });
    if (!html && !text)
      return res.status(400).json({ error: "Se requiere 'html' o 'text'" });

    const result = await emailService.sendEmail({
      to,
      subject,
      html,
      text,
      cc,
      bcc,
      replyTo,
    });

    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function sendSuggestionReceived(req, res, next) {
  try {
    const {
      companyName,
      companyEmail,
      website,
      userName,
      userEmail,
      suggestionId,
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
    if (!companyName)
      return res
        .status(400)
        .json({ error: "El campo 'companyName' es obligatorio" });
    if (!companyEmail)
      return res
        .status(400)
        .json({ error: "El campo 'companyEmail' es obligatorio" });
    if (!validateEmail(companyEmail)) {
      return res
        .status(400)
        .json({ error: "El email de la empresa no es válido" });
    }
    if (!userName)
      return res
        .status(400)
        .json({ error: "El campo 'userName' es obligatorio" });
    if (!userEmail)
      return res
        .status(400)
        .json({ error: "El campo 'userEmail' es obligatorio" });
    if (!suggestionId)
      return res
        .status(400)
        .json({ error: "El campo 'suggestionId' es obligatorio" });

    const finalAdminUrl = `${config.adminSuggestionsUrl.replace(/\/$/, "")}/${suggestionId}`;
    const templateData = {
      companyName,
      companyEmail,
      website: website || "",
      userName,
      userEmail,
      suggestionId,
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

    res.status(200).json({ success: true, to: config.adminEmail, ...result });
  } catch (error) {
    next(error);
  }
}

async function sendBatchEmails(req, res, next) {
  try {
    const { emails } = req.body;

    if (!Array.isArray(emails) || emails.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'emails' con al menos un elemento",
      });
    }

    for (const [i, email] of emails.entries()) {
      if (!email.to) {
        return res
          .status(400)
          .json({ error: `Email en índice ${i}: 'to' es obligatorio` });
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

    const results = await emailService.sendBatchEmails(emails);
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.status(200).json({
      success: true,
      total: results.length,
      succeeded,
      failed,
      results,
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
