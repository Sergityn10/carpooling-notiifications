const express = require("express");
const router = express.Router();
const { requireAuth } = require("../middleware/authMiddleware");
const deviceTokenController = require("../controllers/deviceTokenController");

router.post("/", deviceTokenController.registerDeviceToken);

router.get("/me", requireAuth, deviceTokenController.listMyDeviceTokens);

router.delete("/", requireAuth, deviceTokenController.deactivateDeviceToken);

module.exports = router;
