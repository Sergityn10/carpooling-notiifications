const express = require("express");
const router = express.Router();
const adminNotificationController = require("../controllers/adminNotificationController");
const {
  requireAuth,
  requireAdmin,
  notificationBurstLimiter,
  bulkNotificationLimiter,
} = require("../security");

/**
 * Todas las rutas de este router están restringidas exclusivamente a administradores (SOLO ADMIN).
 */
router.use(requireAuth, requireAdmin);

/**
 * Aplica rate limiting de ráfaga para pruebas/destinatario único y limitador masivo para broadcasts.
 */
function adminSendLimiter(req, res, next) {
  const isSingleOrPreview =
    req.body?.dryRun === true ||
    req.query?.dryRun === "true" ||
    req.body?.sync === true ||
    req.query?.sync === "true" ||
    req.body?.target?.type === "single";

  if (isSingleOrPreview) {
    return notificationBurstLimiter(req, res, next);
  }

  return bulkNotificationLimiter(req, res, next);
}

// Estado integral de la API (BD, SMTP, Firebase/FCM, RabbitMQ, Circuit Breakers, Tokens)
router.get(
  "/status",
  notificationBurstLimiter,
  adminNotificationController.getStatus,
);

// Historial y seguimiento de envíos lanzados desde administración
router.get(
  "/history",
  notificationBurstLimiter,
  adminNotificationController.getHistory,
);

router.get(
  "/jobs/:batchId",
  notificationBurstLimiter,
  adminNotificationController.getJobStatus,
);

// Listado paginado de dispositivos/usuarios conocidos para selector del frontend admin
router.get(
  "/recipients",
  notificationBurstLimiter,
  adminNotificationController.listRecipients,
);

// Previsualización de alcance según filtros sin ejecutar envíos
router.post(
  "/preview",
  notificationBurstLimiter,
  adminNotificationController.previewRecipients,
);

// Envío de correo personalizado (SOLO ADMIN)
router.post(
  "/email",
  adminSendLimiter,
  adminNotificationController.sendCustomEmail,
);

// Envío de notificación push personalizada (SOLO ADMIN)
router.post(
  "/push",
  adminSendLimiter,
  adminNotificationController.sendCustomPush,
);

// Envío multi-canal unificado (Push + Email, SOLO ADMIN)
router.post(
  "/send",
  adminSendLimiter,
  adminNotificationController.sendMultiChannel,
);

module.exports = router;
