const { v4: uuidv4 } = require("uuid");
const amqp = require("amqplib");
const config = require("../config");
const CircuitBreaker = require("../security/circuitBreaker");

// Circuit breakers para dependencias externas (CRIT-03)
const fcmCircuitBreaker = new CircuitBreaker("FirebaseFCM", {
  failureThreshold: 5,
  recoveryTimeoutMs: 25000,
  callTimeoutMs: 8000,
});

const smtpCircuitBreaker = new CircuitBreaker("ZohoSMTP", {
  failureThreshold: 5,
  recoveryTimeoutMs: 25000,
  callTimeoutMs: 10000,
});

// Configuración de RabbitMQ
const EXCHANGE_NOTIFICATIONS = "carpooling_notifications";
const PUSH_QUEUE = "notifications.push.jobs";
const EMAIL_QUEUE = "notifications.email.jobs";
const DLQ_EXCHANGE = "carpooling_notifications_dlq";
const DLQ_QUEUE = "notifications.dead_letter";

// Estado de conexión RabbitMQ
let rmqConnection = null;
let rmqChannel = null;
let isRmqConnected = false;

// Cola interna en memoria con control de backpressure (Fallback de resiliencia)
const MAX_IN_MEMORY_QUEUE_SIZE = 5000;
const memoryPushQueue = [];
const memoryEmailQueue = [];
let isProcessingMemoryQueue = false;

// Concurrencia máxima para consumo local (previene saturación de event loop y sockets)
const MAX_CONCURRENT_PUSH = 5;
const MAX_CONCURRENT_EMAIL = 3;
let activePushTasks = 0;
let activeEmailTasks = 0;

/**
 * Inicializa RabbitMQ y sus colas duraderas si está disponible.
 */
async function initRabbitMQ() {
  if (!config.rabbitmqUrl) {
    console.warn(
      "[NotificationQueue] RABBITMQ_URL no configurada. Operando con cola resiliente en memoria.",
    );
    return;
  }

  try {
    rmqConnection = await amqp.connect(config.rabbitmqUrl);
    rmqConnection.on("error", (err) => {
      console.error("[NotificationQueue] Error en conexión RabbitMQ:", err.message);
      isRmqConnected = false;
    });
    rmqConnection.on("close", () => {
      console.warn("[NotificationQueue] Conexión RabbitMQ cerrada. Conmutando a modo en memoria.");
      isRmqConnected = false;
    });

    rmqChannel = await rmqConnection.createChannel();

    // Dead Letter Exchange y Cola para mensajes fallidos tras reintentos
    await rmqChannel.assertExchange(DLQ_EXCHANGE, "direct", { durable: true });
    await rmqChannel.assertQueue(DLQ_QUEUE, { durable: true });
    await rmqChannel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, "dead_letter");

    // Exchange principal de notificaciones
    await rmqChannel.assertExchange(EXCHANGE_NOTIFICATIONS, "topic", {
      durable: true,
    });

    // Cola de Push Notifications con Dead Letter habilitado
    await rmqChannel.assertQueue(PUSH_QUEUE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLQ_EXCHANGE,
        "x-dead-letter-routing-key": "dead_letter",
        "x-max-priority": 10,
      },
    });
    await rmqChannel.bindQueue(PUSH_QUEUE, EXCHANGE_NOTIFICATIONS, "push.#");

    // Cola de Email Notifications con Dead Letter habilitado
    await rmqChannel.assertQueue(EMAIL_QUEUE, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLQ_EXCHANGE,
        "x-dead-letter-routing-key": "dead_letter",
        "x-max-priority": 10,
      },
    });
    await rmqChannel.bindQueue(EMAIL_QUEUE, EXCHANGE_NOTIFICATIONS, "email.#");

    // Límite de prefetch controlado para no saturar memoria
    rmqChannel.prefetch(10);

    isRmqConnected = true;
    console.log("[NotificationQueue] Conectado exitosamente a RabbitMQ (Colas activas: Push, Email, DLQ).");

    // Iniciar consumidores desacoplados
    startRmqConsumers();
  } catch (error) {
    console.warn(
      `[NotificationQueue] No se pudo conectar a RabbitMQ (${error.message}). Operando con cola resiliente en memoria con control de flujo.`,
    );
    isRmqConnected = false;
  }
}

/**
 * Encola un trabajo de notificación Push de forma no bloqueante.
 * CRIT-03: Responde inmediatamente al cliente (202 Accepted) desacoplando la petición HTTP del envío.
 *
 * @param {object} payload - Datos de la notificación push
 * @returns {Promise<{jobId: string, status: string, queuedAt: string}>}
 */
async function enqueuePush(payload) {
  const jobId = uuidv4();
  const job = {
    jobId,
    type: "PUSH",
    payload,
    attempts: 0,
    maxAttempts: 3,
    queuedAt: new Date().toISOString(),
  };

  if (isRmqConnected && rmqChannel) {
    try {
      const routingKey = payload.topic ? "push.topic" : "push.direct";
      const buffer = Buffer.from(JSON.stringify(job));
      rmqChannel.publish(EXCHANGE_NOTIFICATIONS, routingKey, buffer, {
        persistent: true,
        priority: payload.priority === "high" ? 8 : 4,
      });

      return {
        jobId,
        status: "queued",
        queueType: "rabbitmq",
        queuedAt: job.queuedAt,
      };
    } catch (publishErr) {
      console.warn("[NotificationQueue] Fallo al publicar en RabbitMQ. Redirigiendo a memoria:", publishErr.message);
    }
  }

  // Backpressure Check: Si la cola en memoria supera el límite de seguridad (ataques DoS de 500 req/s)
  if (memoryPushQueue.length >= MAX_IN_MEMORY_QUEUE_SIZE) {
    const error = new Error("Servidor saturado: cola de procesamiento llena. Backpressure activado.");
    error.status = 503;
    error.code = "SERVER_OVERLOAD";
    error.retryAfter = 5;
    throw error;
  }

  memoryPushQueue.push(job);
  triggerMemoryQueueProcessor();

  return {
    jobId,
    status: "queued",
    queueType: "memory_buffer",
    queuedAt: job.queuedAt,
  };
}

/**
 * Encola un trabajo de Email de forma no bloqueante.
 *
 * @param {object} payload - Datos del correo
 * @returns {Promise<{jobId: string, status: string, queuedAt: string}>}
 */
async function enqueueEmail(payload) {
  const jobId = uuidv4();
  const job = {
    jobId,
    type: "EMAIL",
    payload,
    attempts: 0,
    maxAttempts: 3,
    queuedAt: new Date().toISOString(),
  };

  if (isRmqConnected && rmqChannel) {
    try {
      const routingKey = payload.template ? "email.template" : "email.raw";
      const buffer = Buffer.from(JSON.stringify(job));
      rmqChannel.publish(EXCHANGE_NOTIFICATIONS, routingKey, buffer, {
        persistent: true,
      });

      return {
        jobId,
        status: "queued",
        queueType: "rabbitmq",
        queuedAt: job.queuedAt,
      };
    } catch (publishErr) {
      console.warn("[NotificationQueue] Fallo al publicar en RabbitMQ. Redirigiendo a memoria:", publishErr.message);
    }
  }

  if (memoryEmailQueue.length >= MAX_IN_MEMORY_QUEUE_SIZE) {
    const error = new Error("Servidor saturado: cola de emails llena. Backpressure activado.");
    error.status = 503;
    error.code = "SERVER_OVERLOAD";
    error.retryAfter = 5;
    throw error;
  }

  memoryEmailQueue.push(job);
  triggerMemoryQueueProcessor();

  return {
    jobId,
    status: "queued",
    queueType: "memory_buffer",
    queuedAt: job.queuedAt,
  };
}

/**
 * Consumidores de RabbitMQ desacoplados con control de flujo y reintentos.
 */
function startRmqConsumers() {
  if (!rmqChannel) return;

  // Consumidor de Push
  rmqChannel.consume(
    PUSH_QUEUE,
    async (msg) => {
      if (!msg) return;
      try {
        const job = JSON.parse(msg.content.toString());
        await processPushJob(job);
        rmqChannel.ack(msg);
      } catch (err) {
        console.error("[NotificationQueue:PushWorker] Error procesando push:", err.message);
        // Si es un error transitorio y no ha superado reintentos, nack sin requeue para mandar a DLQ
        rmqChannel.nack(msg, false, false);
      }
    },
    { noAck: false },
  );

  // Consumidor de Email
  rmqChannel.consume(
    EMAIL_QUEUE,
    async (msg) => {
      if (!msg) return;
      try {
        const job = JSON.parse(msg.content.toString());
        await processEmailJob(job);
        rmqChannel.ack(msg);
      } catch (err) {
        console.error("[NotificationQueue:EmailWorker] Error procesando email:", err.message);
        rmqChannel.nack(msg, false, false);
      }
    },
    { noAck: false },
  );
}

/**
 * Procesador de la cola en memoria con control estricto de concurrencia.
 */
function triggerMemoryQueueProcessor() {
  if (isProcessingMemoryQueue) return;
  isProcessingMemoryQueue = true;

  setImmediate(async () => {
    while (
      (memoryPushQueue.length > 0 && activePushTasks < MAX_CONCURRENT_PUSH) ||
      (memoryEmailQueue.length > 0 && activeEmailTasks < MAX_CONCURRENT_EMAIL)
    ) {
      if (memoryPushQueue.length > 0 && activePushTasks < MAX_CONCURRENT_PUSH) {
        const pushJob = memoryPushQueue.shift();
        if (pushJob) {
          activePushTasks++;
          processPushJob(pushJob)
            .catch((err) => {
              console.error(
                `[NotificationQueue:MemoryWorker] Fallo en push ${pushJob.jobId}:`,
                err.message,
              );
            })
            .finally(() => {
              activePushTasks--;
              triggerMemoryQueueProcessor();
            });
        }
      }

      if (memoryEmailQueue.length > 0 && activeEmailTasks < MAX_CONCURRENT_EMAIL) {
        const emailJob = memoryEmailQueue.shift();
        if (emailJob) {
          activeEmailTasks++;
          processEmailJob(emailJob)
            .catch((err) => {
              console.error(
                `[NotificationQueue:MemoryWorker] Fallo en email ${emailJob.jobId}:`,
                err.message,
              );
            })
            .finally(() => {
              activeEmailTasks--;
              triggerMemoryQueueProcessor();
            });
        }
      }

      // Pequeño yield para ceder el event loop si hay muchas tareas
      if (activePushTasks >= MAX_CONCURRENT_PUSH && activeEmailTasks >= MAX_CONCURRENT_EMAIL) {
        break;
      }
    }

    isProcessingMemoryQueue = false;
  });
}

let customPushHandler = null;
let customEmailHandler = null;

function setCustomHandlers(handlers = {}) {
  customPushHandler = handlers.pushHandler || null;
  customEmailHandler = handlers.emailHandler || null;
}

function clearMemoryQueue() {
  memoryPushQueue.length = 0;
  memoryEmailQueue.length = 0;
}

/**
 * Procesa un trabajo de Push Notification llamando a pushService protegido por CircuitBreaker.
 */
async function processPushJob(job) {
  if (customPushHandler) {
    return customPushHandler(job);
  }

  const pushService = require("./pushService");
  const { payload } = job;

  return fcmCircuitBreaker.execute(async () => {
    if (payload.token) {
      return pushService.sendToTokenDirect(payload.token, payload);
    } else if (payload.tokens && Array.isArray(payload.tokens)) {
      return pushService.sendToTokensDirect(payload.tokens, payload);
    } else if (payload.topic) {
      return pushService.sendToTopicDirect(payload.topic, payload);
    } else {
      throw new Error("Payload de notificación push inválido: falta token, tokens o topic");
    }
  });
}

/**
 * Procesa un trabajo de Email llamando a emailService protegido por CircuitBreaker.
 */
async function processEmailJob(job) {
  if (customEmailHandler) {
    return customEmailHandler(job);
  }

  const emailService = require("./emailService");
  const { payload } = job;

  return smtpCircuitBreaker.execute(async () => {
    if (payload.template) {
      return emailService.sendTemplatedEmailDirect(payload);
    } else if (payload.batch && Array.isArray(payload.emails)) {
      return emailService.sendBatchEmailsDirect(payload.emails);
    } else {
      return emailService.sendEmailDirect(payload);
    }
  });
}

/**
 * Obtiene métricas del estado de la cola y circuit breakers (Health Probes).
 */
function getQueueHealth() {
  return {
    rabbitmqConnected: isRmqConnected,
    memoryQueue: {
      pushPending: memoryPushQueue.length,
      emailPending: memoryEmailQueue.length,
      activePushWorkers: activePushTasks,
      activeEmailWorkers: activeEmailTasks,
      maxBuffer: MAX_IN_MEMORY_QUEUE_SIZE,
    },
    circuitBreakers: {
      fcm: fcmCircuitBreaker.getStatus(),
      smtp: smtpCircuitBreaker.getStatus(),
    },
  };
}

/**
 * Cierre limpio de RabbitMQ para graceful shutdown.
 */
async function closeRabbitMQ() {
  try {
    if (rmqChannel) await rmqChannel.close();
  } catch (err) {
    // ignorar error de cierre
  }
  try {
    if (rmqConnection) await rmqConnection.close();
  } catch (err) {
    // ignorar error de cierre
  }
  isRmqConnected = false;
}

module.exports = {
  initRabbitMQ,
  enqueuePush,
  enqueueEmail,
  processPushJob,
  processEmailJob,
  setCustomHandlers,
  clearMemoryQueue,
  fcmCircuitBreaker,
  smtpCircuitBreaker,
  getQueueHealth,
  closeRabbitMQ,
};
