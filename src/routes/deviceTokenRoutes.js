const express = require("express");
const router = express.Router();
const deviceTokenController = require("../controllers/deviceTokenController");
const {
  requireAuth,
  requireAdmin,
  requireOwnership,
  notificationBurstLimiter,
} = require("../security");

// Registro y consulta de dispositivos propios
router.post(
  "/",
  notificationBurstLimiter,
  requireAuth,
  deviceTokenController.registerDeviceToken,
);

router.get("/me", requireAuth, deviceTokenController.listMyDeviceTokens);

// Supervisión de administradores (BFLA mitigado)
router.get(
  "/admin/all",
  requireAuth,
  requireAdmin,
  deviceTokenController.listAllDeviceTokens,
);

// Consulta por userId con control ABAC / Ownership (el usuario puede ver los suyos, admin cualquiera)
router.get(
  "/admin/user/:userId",
  requireAuth,
  requireOwnership((req) => req.params.userId),
  deviceTokenController.listUserDeviceTokensAdmin,
);

// Desactivación de dispositivo
router.delete(
  "/",
  notificationBurstLimiter,
  requireAuth,
  deviceTokenController.deactivateDeviceToken,
);

module.exports = router;
