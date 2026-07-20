const express = require("express");
const router = express.Router();
const { requireAuth, requireAdmin } = require("../middleware/authMiddleware");
const deviceTokenController = require("../controllers/deviceTokenController");

router.post("/", requireAuth, deviceTokenController.registerDeviceToken);

router.get("/me", requireAuth, deviceTokenController.listMyDeviceTokens);

router.get(
  "/admin/all",
  requireAuth,
  requireAdmin,
  deviceTokenController.listAllDeviceTokens,
);

router.get(
  "/admin/user/:userId",
  requireAuth,
  requireAdmin,
  deviceTokenController.listUserDeviceTokensAdmin,
);

router.delete("/", requireAuth, deviceTokenController.deactivateDeviceToken);

module.exports = router;
