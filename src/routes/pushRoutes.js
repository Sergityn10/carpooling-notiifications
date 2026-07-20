const express = require("express");
const router = express.Router();
const pushController = require("../controllers/pushController");

router.post("/send", pushController.sendToToken);

router.post("/send/multicast", pushController.sendToTokens);

router.post("/send/user", pushController.sendToUser);

router.post("/send/template/user", pushController.sendTemplatedToUser);

router.post("/send/topic", pushController.sendToTopic);

router.post("/topic/subscribe", pushController.subscribeToTopic);

router.post("/topic/unsubscribe", pushController.unsubscribeFromTopic);

module.exports = router;
