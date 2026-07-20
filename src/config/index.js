require("dotenv").config();

const config = {
  port: process.env.PORT || 3004,
  nodeEnv: process.env.NODE_ENV || "development",
  smtp: {
    host: process.env.SMTP_HOST || "localhost",
    port: parseInt(process.env.SMTP_PORT || "587", 10),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "Carpooling",
    fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@carpooling.com",
  },
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminSuggestionsUrl: process.env.ADMIN_SUGGESTIONS_URL || "",
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
};

module.exports = config;
