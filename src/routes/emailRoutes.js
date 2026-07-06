const express = require("express");
const router = express.Router();
const emailController = require("../controllers/emailController");

router.get("/templates", emailController.listTemplates);

router.get("/health/smtp", emailController.verifyConnection);

router.post("/send", emailController.sendRawEmail);

router.post("/send/template", emailController.sendTemplatedEmail);

router.post("/send/batch", emailController.sendBatchEmails);

module.exports = router;
