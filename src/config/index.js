require("dotenv").config();

function parseIntEnv(value, fallback) {
  const parsed = parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const config = {
  port: process.env.PORT || 3004,
  nodeEnv: process.env.NODE_ENV || "development",
  runWorkers: process.env.RUN_WORKERS !== "false",
  serviceApiKey:
    process.env.INTERNAL_SERVICE_API_KEY || process.env.SERVICE_API_KEY || "",
  smtp: {
    host: process.env.SMTP_HOST || "localhost",
    port: parseIntEnv(process.env.SMTP_PORT, 587),
    user: process.env.SMTP_USER || "",
    pass: process.env.SMTP_PASS || "",
    fromName: process.env.SMTP_FROM_NAME || "YouConnext",
    fromEmail: process.env.SMTP_FROM_EMAIL || "noreply@youconnext.es",
    maxConnections: parseIntEnv(process.env.SMTP_MAX_CONNECTIONS, 3),
  },
  userService: {
    url: (process.env.USER_SERVICE_URL || "").replace(/\/$/, ""),
    batchPath: process.env.USER_SERVICE_BATCH_PATH || "/api/users/internal/batch",
    timeoutMs: parseIntEnv(process.env.USER_SERVICE_TIMEOUT_MS, 5000),
    allowDeviceEmailFallback:
      process.env.ALLOW_DEVICE_EMAIL_FALLBACK === "true",
  },
  batch: {
    maxRecipients: parseIntEnv(process.env.MAX_BATCH_RECIPIENTS, 5000),
    idLookupChunkSize: parseIntEnv(process.env.USER_LOOKUP_CHUNK_SIZE, 500),
    emailLookupChunkSize: parseIntEnv(process.env.EMAIL_LOOKUP_CHUNK_SIZE, 200),
    pushChunkSize: parseIntEnv(process.env.PUSH_BATCH_CHUNK_SIZE, 500),
    rabbitmqPrefetch: parseIntEnv(process.env.RABBITMQ_PREFETCH, 20),
    maxConcurrentPush: parseIntEnv(process.env.MAX_CONCURRENT_PUSH, 5),
    maxConcurrentEmail: parseIntEnv(process.env.MAX_CONCURRENT_EMAIL, 3),
    idempotencyTtlMs: parseIntEnv(
      process.env.BATCH_IDEMPOTENCY_TTL_MS,
      15 * 60 * 1000,
    ),
    idempotencyMaxEntries: parseIntEnv(
      process.env.BATCH_IDEMPOTENCY_MAX_ENTRIES,
      10000,
    ),
  },
  adminEmail: process.env.ADMIN_EMAIL || "",
  adminSuggestionsUrl: process.env.ADMIN_SUGGESTIONS_URL || "",
  frontendUrl: process.env.FRONTEND_URL || "",
  rabbitmqUrl: process.env.RABBITMQ_URL || "",
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID || "",
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    privateKey: (process.env.FIREBASE_PRIVATE_KEY || "").replace(/\\n/g, "\n"),
  },
};

module.exports = config;
