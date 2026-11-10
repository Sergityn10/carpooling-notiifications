const express = require("express");
const router = express.Router();
const notificationController = require("../controllers/notificationController");
const {
  requireAuth,
  requireAdmin,
  bulkNotificationLimiter,
} = require("../security");

// Catálogo unificado de tipos de notificación multi-canal
router.get("/catalog", requireAuth, notificationController.getCatalog);

// Envío masivo multi-canal desacoplado (ms-trayectos / servicios internos / admin)
router.post(
  "/batch",
  requireAuth,
  requireAdmin,
  bulkNotificationLimiter,
  notificationController.sendBatch,
);

module.exports = router;
