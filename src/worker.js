const prisma = require("./lib/prisma");
const config = require("./config");
const { startConsumer, stopConsumer } = require("./services/rabbitmqConsumer");
const notificationQueue = require("./services/notificationQueue");

let isShuttingDown = false;

async function startWorker() {
  console.log(
    `[Worker] Starting dedicated RabbitMQ notification worker [${config.nodeEnv}]...`,
  );

  await startConsumer();
  await notificationQueue.initRabbitMQ({ startConsumers: true });
}

async function gracefulShutdown(signal) {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`[Worker] Recibida señal ${signal}. Deteniendo consumidores...`);

  try {
    await stopConsumer();
    await notificationQueue.closeRabbitMQ();
    await prisma.$disconnect();
    console.log("[Worker] Consumidores y conexiones cerrados limpiamente.");
  } catch (err) {
    console.error("[Worker] Error durante apagado:", err.message);
  } finally {
    process.exit(0);
  }
}

process.on("SIGINT", () => gracefulShutdown("SIGINT"));
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

process.on("uncaughtException", (err) => {
  console.error("[Worker FATAL: uncaughtException]", err);
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  console.error("[Worker CRITICAL: unhandledRejection]", reason);
});

if (require.main === module) {
  startWorker().catch((err) => {
    console.error("[Worker] Error fatal al iniciar:", err);
    process.exit(1);
  });
}

module.exports = { startWorker, gracefulShutdown };
