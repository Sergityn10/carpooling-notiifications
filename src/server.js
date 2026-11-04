const express = require("express");
const cors = require("cors");
const config = require("./config");
const prisma = require("./lib/prisma");
const emailRoutes = require("./routes/emailRoutes");
const pushRoutes = require("./routes/pushRoutes");
const deviceTokenRoutes = require("./routes/deviceTokenRoutes");
const { notFound, errorHandler } = require("./middleware/errorMiddleware");
const { startConsumer, stopConsumer } = require("./services/rabbitmqConsumer");
const notificationQueue = require("./services/notificationQueue");
const {
  applySecurityHeaders,
  generalApiLimiter,
} = require("./security");

const app = express();

// 1. Hardening HTTP y cabeceras de seguridad (HSTS, CSP, nosniff, DENY, ocultar X-Powered-By)
applySecurityHeaders(app);

// 2. Control CORS estricto
const ALLOWED_ORIGINS = [
  "http://localhost:5173",
  "http://localhost:5174",
  "http://localhost:4001",
  "http://localhost:3000",
  "https://www.youconnext.es",
  "https://app.youconnext.es",
  "https://admin.youconnext.es",
  "https://youconnext-nextjs.vercel.app",
  "https://carpooling-webapp-ten.vercel.app",
  "https://youconnext-landing-page.vercel.app",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Permite peticiones sin origin (herramientas internas, apps móviles, cron jobs) o dominios autorizados
      if (!origin || ALLOWED_ORIGINS.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error("Origen bloqueado por política CORS"));
    },
    methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "Authentication",
      "X-Service-Api-Key",
      "X-Requested-With",
    ],
  }),
);

// 3. Rate limiting general defensivo (MED-10 a MED-22)
app.use(generalApiLimiter);

// 4. Parsers con límites de payload para mitigar DoS por payloads masivos
app.use(express.json({ limit: "500kb" }));
app.use(express.urlencoded({ extended: true, limit: "500kb" }));

// 5. Endpoints de Health Check y Monitoreo de Supervisión (CRIT-04)
const startTime = Date.now();

app.get("/health", (req, res) => {
  res.status(200).json({
    status: "ok",
    service: "carpooling-notifications",
    version: "1.0.0",
    uptimeSeconds: Math.floor((Date.now() - startTime) / 1000),
    timestamp: new Date().toISOString(),
  });
});

// Liveness Probe: Para Kubernetes / Docker / PM2
app.get("/health/liveness", (req, res) => {
  res.status(200).json({
    status: "healthy",
    check: "liveness",
    timestamp: new Date().toISOString(),
  });
});

// Readiness Probe: Verifica que BD y broker respondan antes de recibir tráfico
app.get("/health/readiness", async (req, res) => {
  try {
    let dbStatus = "ok";
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch (dbErr) {
      dbStatus = "error: " + dbErr.message;
    }

    const queueHealth = notificationQueue.getQueueHealth();
    const isDegraded = dbStatus !== "ok";

    const responsePayload = {
      status: isDegraded ? "degraded" : "ready",
      database: dbStatus,
      queue: queueHealth,
      memory: {
        rssMb: Math.round(process.memoryUsage().rss / 1024 / 1024),
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      },
      timestamp: new Date().toISOString(),
    };

    if (isDegraded) {
      return res.status(503).json(responsePayload);
    }

    return res.status(200).json(responsePayload);
  } catch (err) {
    return res.status(503).json({
      status: "unhealthy",
      error: err.message,
      timestamp: new Date().toISOString(),
    });
  }
});

// Métricas de resiliencia
app.get("/health/metrics", (req, res) => {
  res.status(200).json({
    memory: process.memoryUsage(),
    uptimeSeconds: process.uptime(),
    queue: notificationQueue.getQueueHealth(),
  });
});

// 6. Rutas de la API protegidas
app.use("/api/emails", emailRoutes);
app.use("/api/push", pushRoutes);
app.use("/api/device-tokens", deviceTokenRoutes);

// 7. Manejadores de 404 y Errores
app.use(notFound);
app.use(errorHandler);

// 8. Arranque del servidor y consumidores (solo al ejecutarse directamente, no al importarse en tests)
let server = null;

if (require.main === module) {
  server = app.listen(config.port, async () => {
    console.log(
      `[Server] Notifications service running on port ${config.port} [${config.nodeEnv}]`,
    );
    // Iniciar consumidor de eventos de negocio RabbitMQ
    startConsumer();
    // Iniciar colas asíncronas de notificaciones
    await notificationQueue.initRabbitMQ();
  });
}

// 9. Resiliencia de proceso y Graceful Shutdown (CRIT-04)
let isShuttingDown = false;

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Server] Recibida señal ${signal}. Iniciando apagado seguro...`);

  // Dejar de aceptar nuevas conexiones HTTP
  if (server) {
    server.close(() => {
      console.log("[Server] Servidor HTTP cerrado.");
    });
  }

  try {
    await stopConsumer();
    await notificationQueue.closeRabbitMQ();
    await prisma.$disconnect();
    console.log("[Server] Conexiones cerradas limpiamente.");
  } catch (err) {
    console.error("[Server] Error durante apagado:", err.message);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

// Detección de errores fatales no controlados para reinicio supervisor (CRIT-04)
process.on("uncaughtException", (err) => {
  console.error("[FATAL: uncaughtException]", err);
  // Dejar que el supervisor de procesos (PM2/K8s) reinicie limpiamente
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[CRITICAL: unhandledRejection]", reason);
});

module.exports = app;
