const express = require("express");
const router = express.Router();
const pushController = require("../controllers/pushController");
const {
  requireAuth,
  requireAdmin,
  notificationBurstLimiter,
  bulkNotificationLimiter,
} = require("../security");

// Notificaciones individuales por token o usuario: autenticación estricta + rate limiter de ráfagas
router.post(
  "/send",
  notificationBurstLimiter,
  requireAuth,
  pushController.sendToToken,
);

router.post(
  "/send/user",
  notificationBurstLimiter,
  requireAuth,
  pushController.sendToUser,
);

router.post(
  "/send/template/user",
  notificationBurstLimiter,
  requireAuth,
  pushController.sendTemplatedToUser,
);

// Notificaciones masivas o por topics: requieren rol admin exclusivo (BFLA) + rate limiter masivo
router.post(
  "/send/multicast",
  bulkNotificationLimiter,
  requireAuth,
  requireAdmin,
  pushController.sendToTokens,
);

router.post(
  "/send/topic",
  bulkNotificationLimiter,
  requireAuth,
  requireAdmin,
  pushController.sendToTopic,
);

router.post(
  "/topic/subscribe",
  bulkNotificationLimiter,
  requireAuth,
  requireAdmin,
  pushController.subscribeToTopic,
);

router.post(
  "/topic/unsubscribe",
  bulkNotificationLimiter,
  requireAuth,
  requireAdmin,
  pushController.unsubscribeFromTopic,
);

module.exports = router;
