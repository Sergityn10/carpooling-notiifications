const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");
const {
  requireAuth,
  requireAdmin,
  notificationBurstLimiter,
  bulkNotificationLimiter,
} = require("../security");

// Catálogo de plantillas: requiere autenticación
router.get("/templates", requireAuth, emailController.listTemplates);

// Estado de conexión SMTP: reservado a administradores
router.get(
  "/health/smtp",
  requireAuth,
  requireAdmin,
  emailController.verifyConnection,
);

// Envío crudo (raw email): restringido estrictamente a administradores o llamadas internas de servicio
router.post(
  "/send",
  notificationBurstLimiter,
  requireAuth,
  requireAdmin,
  emailController.sendRawEmail,
);

// Envío de correos por plantilla estándar: requiere usuario autenticado + control de ráfaga
router.post(
  "/send/template",
  notificationBurstLimiter,
  requireAuth,
  emailController.sendTemplatedEmail,
);

// Envío de formulario de sugerencias de usuario hacia administración
router.post(
  "/send/suggestion",
  notificationBurstLimiter,
  requireAuth,
  emailController.sendSuggestionReceived,
);

// Envío masivo por lotes (Batch): restringido a administradores (BFLA/Anti-spam) + limitador masivo
router.post(
  "/send/batch",
  bulkNotificationLimiter,
  requireAuth,
  requireAdmin,
  emailController.sendBatchEmails,
);

module.exports = router;
