const { v4: uuidv4 } = require("uuid");
const amqp = require("amqplib");
const config = require("../config");
const CircuitBreaker = require("../security/circuitBreaker");
const { chunkArray } = require("../utils/templateInterpolator");
const {
  EXCHANGES,
  EXCHANGE_TYPES,
  QUEUES,
  ROUTING_KEYS,
  RETRY_POLICY,
  getRetryQueueName,
  OUTBOUND_EVENTS,
  JOB_KINDS,
  NOTIFICATION_PRIORITIES,
} = require("../constants");

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
const EXCHANGE_NOTIFICATIONS = EXCHANGES.NOTIFICATIONS;
const PUSH_QUEUE = QUEUES.DELIVERY.PUSH;
const EMAIL_QUEUE = QUEUES.DELIVERY.EMAIL;
const DLQ_EXCHANGE = EXCHANGES.DLQ;
const DLQ_QUEUE = QUEUES.DLQ;
const RETRY_STEPS = RETRY_POLICY.STEPS;

// Estado de conexión RabbitMQ
let rmqConnection = null;
let rmqChannel = null;
let isRmqConnected = false;

// Cola interna en memoria con control de backpressure (Fallback de resiliencia)
const MAX_IN_MEMORY_QUEUE_SIZE = 5000;
const memoryPushQueue = [];
const memoryEmailQueue = [];
const pendingRetryTimers = new Set();
let isProcessingMemoryQueue = false;

// Concurrencia máxima para consumo local (previene saturación de event loop y sockets)
const MAX_CONCURRENT_PUSH = config.batch?.maxConcurrentPush || 5;
const MAX_CONCURRENT_EMAIL = config.batch?.maxConcurrentEmail || 3;
let activePushTasks = 0;
let activeEmailTasks = 0;

function isPermanentError(err) {
  if (!err) return false;
  if (err.isPermanent === true) return true;
  if (
    err.code === "INVALID_PAYLOAD" ||
    err.code === "USER_SERVICE_NOT_CONFIGURED" ||
    err.code === "EENVELOPE"
  ) {
    return true;
  }
  const code = Number(err.responseCode);
  if ([550, 551, 552, 553].includes(code)) {
    return true;
  }
  return false;
}

async function assertChannelQueues(channel, { queueName, bindPattern, channelType, retryRoutingKey }) {
  await channel.assertQueue(queueName, {
    durable: true,
    arguments: {
      "x-dead-letter-exchange": DLQ_EXCHANGE,
      "x-dead-letter-routing-key": ROUTING_KEYS.DLQ,
      "x-max-priority": 10,
    },
  });
  await channel.bindQueue(queueName, EXCHANGE_NOTIFICATIONS, bindPattern);

  for (const step of RETRY_STEPS) {
    await channel.assertQueue(`notifications.${channelType}.retry.${step.suffix}`, {
      durable: true,
      arguments: {
        "x-message-ttl": step.ttlMs,
        "x-dead-letter-exchange": EXCHANGE_NOTIFICATIONS,
        "x-dead-letter-routing-key": retryRoutingKey,
      },
    });
  }
}

/**
 * Inicializa RabbitMQ y sus colas duraderas (con retry TTL y DLQ) si está disponible.
 * @param {object} [options]
 * @param {boolean} [options.startConsumers=true] - Si false, solo inicializa capacidad de publicación (modo API ingress)
 */
async function initRabbitMQ({ startConsumers = true } = {}) {
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

    await rmqChannel.assertExchange(DLQ_EXCHANGE, EXCHANGE_TYPES.DIRECT, { durable: true });
    await rmqChannel.assertQueue(DLQ_QUEUE, { durable: true });
    await rmqChannel.bindQueue(DLQ_QUEUE, DLQ_EXCHANGE, ROUTING_KEYS.DLQ);

    await rmqChannel.assertExchange(EXCHANGE_NOTIFICATIONS, EXCHANGE_TYPES.TOPIC, {
      durable: true,
    });

    await assertChannelQueues(rmqChannel, {
      queueName: PUSH_QUEUE,
      bindPattern: ROUTING_KEYS.DELIVERY_PATTERNS.PUSH,
      channelType: "push",
      retryRoutingKey: OUTBOUND_EVENTS.INTERNAL_JOBS.PUSH_RETRY,
    });

    await assertChannelQueues(rmqChannel, {
      queueName: EMAIL_QUEUE,
      bindPattern: ROUTING_KEYS.DELIVERY_PATTERNS.EMAIL,
      channelType: "email",
      retryRoutingKey: OUTBOUND_EVENTS.INTERNAL_JOBS.EMAIL_RETRY,
    });

    const prefetchCount = config.batch?.rabbitmqPrefetch || 20;
    rmqChannel.prefetch(prefetchCount);

    isRmqConnected = true;
    console.log(
      `[NotificationQueue] Conectado a RabbitMQ (consumers=${startConsumers}, prefetch=${prefetchCount}, DLQ+RetryTTL activos).`,
    );

    if (startConsumers) {
      startRmqConsumers();
    }
  } catch (error) {
    console.warn(
      `[NotificationQueue] No se pudo conectar a RabbitMQ (${error.message}). Operando con cola resiliente en memoria.`,
    );
    isRmqConnected = false;
  }
}

function isRabbitMQConnected() {
  return Boolean(isRmqConnected && rmqChannel);
}

function resolvePushRoutingKey(payload) {
  if (payload.topic) return OUTBOUND_EVENTS.INTERNAL_JOBS.PUSH_TOPIC;
  if (payload.jobKind === JOB_KINDS.USERS_BATCH) {
    return OUTBOUND_EVENTS.INTERNAL_JOBS.PUSH_BATCH;
  }
  return OUTBOUND_EVENTS.INTERNAL_JOBS.PUSH_DIRECT;
}

function resolveEmailRoutingKey(payload) {
  if (payload.jobKind === JOB_KINDS.USERS_LOOKUP_FANOUT) {
    return OUTBOUND_EVENTS.INTERNAL_JOBS.EMAIL_LOOKUP;
  }
  if (payload.template) return OUTBOUND_EVENTS.INTERNAL_JOBS.EMAIL_TEMPLATE;
  return OUTBOUND_EVENTS.INTERNAL_JOBS.EMAIL_RAW;
}

async function enqueueJob({
  type,
  payload,
  routingKey,
  memoryQueue,
  priority,
  overloadMessage,
}) {
  const jobId = uuidv4();
  const job = {
    jobId,
    type,
    payload,
    attempts: 0,
    maxAttempts: RETRY_POLICY.MAX_ATTEMPTS,
    queuedAt: new Date().toISOString(),
  };

  if (isRmqConnected && rmqChannel) {
    try {
      const buffer = Buffer.from(JSON.stringify(job));
      rmqChannel.publish(EXCHANGE_NOTIFICATIONS, routingKey, buffer, {
        persistent: true,
        priority,
        headers: { [RETRY_POLICY.RETRY_COUNT_HEADER]: 0 },
      });

      return {
        jobId,
        status: "queued",
        queueType: "rabbitmq",
        queuedAt: job.queuedAt,
      };
    } catch (publishErr) {
      console.warn(
        `[NotificationQueue] Fallo al publicar ${type} en RabbitMQ. Redirigiendo a memoria:`,
        publishErr.message,
      );
    }
  }

  if (memoryQueue.length >= MAX_IN_MEMORY_QUEUE_SIZE) {
    const error = new Error(overloadMessage);
    error.status = 503;
    error.code = "SERVER_OVERLOAD";
    error.retryAfter = 5;
    throw error;
  }

  memoryQueue.push(job);
  triggerMemoryQueueProcessor();

  return {
    jobId,
    status: "queued",
    queueType: "memory_buffer",
    queuedAt: job.queuedAt,
  };
}

/**
 * Encola un trabajo de notificación Push de forma no bloqueante.
 */
async function enqueuePush(payload) {
  return enqueueJob({
    type: "PUSH",
    payload,
    routingKey: resolvePushRoutingKey(payload),
    memoryQueue: memoryPushQueue,
    priority: payload.priority === NOTIFICATION_PRIORITIES.HIGH ? 8 : 4,
    overloadMessage:
      "Servidor saturado: cola de procesamiento push llena. Backpressure activado.",
  });
}

/**
 * Encola un trabajo de Email de forma no bloqueante.
 */
async function enqueueEmail(payload) {
  return enqueueJob({
    type: "EMAIL",
    payload,
    routingKey: resolveEmailRoutingKey(payload),
    memoryQueue: memoryEmailQueue,
    priority: payload.priority === NOTIFICATION_PRIORITIES.HIGH ? 7 : 4,
    overloadMessage:
      "Servidor saturado: cola de emails llena. Backpressure activado.",
  });
}

async function handleRmqFailure(msg, channelType, job, err) {
  const retryCount = Number(
    msg.properties?.headers?.[RETRY_POLICY.RETRY_COUNT_HEADER] ??
      job?.attempts ??
      0,
  );
  const maxAttempts = job?.maxAttempts ?? RETRY_POLICY.MAX_ATTEMPTS;

  if (!isPermanentError(err) && retryCount < maxAttempts) {
    const nextAttempt = retryCount + 1;
    const retryQueue = getRetryQueueName(channelType, retryCount);
    const updatedJob = { ...job, attempts: nextAttempt, lastError: err.message };

    try {
      rmqChannel.sendToQueue(
        retryQueue,
        Buffer.from(JSON.stringify(updatedJob)),
        {
          persistent: true,
          headers: {
            ...(msg.properties?.headers || {}),
            [RETRY_POLICY.RETRY_COUNT_HEADER]: nextAttempt,
          },
        },
      );
      rmqChannel.ack(msg);
      return;
    } catch (requeueErr) {
      console.error(
        `[NotificationQueue:${channelType}] Error al reencolar en ${retryQueue}:`,
        requeueErr.message,
      );
    }
  }

  rmqChannel.nack(msg, false, false);
}

/**
 * Consumidores de RabbitMQ desacoplados con control de flujo, retry TTL y DLQ.
 */
function startRmqConsumers() {
  if (!rmqChannel) return;

  rmqChannel.consume(
    PUSH_QUEUE,
    async (msg) => {
      if (!msg) return;
      let job = null;
      try {
        job = JSON.parse(msg.content.toString());
        await processPushJob(job);
        rmqChannel.ack(msg);
      } catch (err) {
        console.error(
          "[NotificationQueue:PushWorker] Error procesando push:",
          err.message,
        );
        await handleRmqFailure(msg, "push", job, err);
      }
    },
    { noAck: false },
  );

  rmqChannel.consume(
    EMAIL_QUEUE,
    async (msg) => {
      if (!msg) return;
      let job = null;
      try {
        job = JSON.parse(msg.content.toString());
        await processEmailJob(job);
        rmqChannel.ack(msg);
      } catch (err) {
        console.error(
          "[NotificationQueue:EmailWorker] Error procesando email:",
          err.message,
        );
        await handleRmqFailure(msg, "email", job, err);
      }
    },
    { noAck: false },
  );
}

function scheduleMemoryRetry(job, queue, err) {
  if (isPermanentError(err)) return;
  const maxAttempts = job.maxAttempts ?? 3;
  if (job.attempts >= maxAttempts) return;
  if (queue.length >= MAX_IN_MEMORY_QUEUE_SIZE) return;

  job.attempts += 1;
  const delayMs = Math.min(1000 * 2 ** (job.attempts - 1), 10000);
  const timer = setTimeout(() => {
    pendingRetryTimers.delete(timer);
    if (queue.length < MAX_IN_MEMORY_QUEUE_SIZE) {
      queue.push(job);
      triggerMemoryQueueProcessor();
    }
  }, delayMs);

  if (typeof timer.unref === "function") timer.unref();
  pendingRetryTimers.add(timer);
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
              scheduleMemoryRetry(pushJob, memoryPushQueue, err);
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
              scheduleMemoryRetry(emailJob, memoryEmailQueue, err);
            })
            .finally(() => {
              activeEmailTasks--;
              triggerMemoryQueueProcessor();
            });
        }
      }

      if (
        activePushTasks >= MAX_CONCURRENT_PUSH &&
        activeEmailTasks >= MAX_CONCURRENT_EMAIL
      ) {
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
  for (const timer of pendingRetryTimers) {
    clearTimeout(timer);
  }
  pendingRetryTimers.clear();
}

/**
 * Procesa un trabajo de Push Notification llamando a pushService/pushChannel protegido por CircuitBreaker.
 */
async function processPushJob(job) {
  if (customPushHandler) {
    return customPushHandler(job);
  }

  const pushService = require("./pushService");
  const { payload } = job;

  if (payload.jobKind === JOB_KINDS.USERS_BATCH) {
    const pushChannel = require("./channels/pushChannel");
    return pushChannel.processUsersBatchJob(payload, fcmCircuitBreaker);
  }

  if (payload.token) {
    return fcmCircuitBreaker.execute(() =>
      pushService.sendToTokenDirect(payload.token, payload),
    );
  }

  if (Array.isArray(payload.tokens)) {
    const results = [];
    for (const chunk of chunkArray(payload.tokens, 500)) {
      const chunkRes = await fcmCircuitBreaker.execute(() =>
        pushService.sendToTokensDirect(chunk, payload),
      );
      results.push(...chunkRes);
    }
    return results;
  }

  if (payload.topic) {
    return fcmCircuitBreaker.execute(() =>
      pushService.sendToTopicDirect(payload.topic, payload),
    );
  }

  const err = new Error(
    "Payload de notificación push inválido: falta token, tokens, topic o userIds",
  );
  err.code = "INVALID_PAYLOAD";
  err.isPermanent = true;
  throw err;
}

/**
 * Procesa un trabajo de Email llamando a emailService/emailChannel protegido por CircuitBreaker.
 */
async function processEmailJob(job) {
  if (customEmailHandler) {
    return customEmailHandler(job);
  }

  const emailService = require("./emailService");
  const { payload } = job;

  if (payload.jobKind === JOB_KINDS.USERS_LOOKUP_FANOUT) {
    const emailChannel = require("./channels/emailChannel");
    return emailChannel.processLookupFanoutJob(payload);
  }

  if (payload.template) {
    return smtpCircuitBreaker.execute(() =>
      emailService.sendTemplatedEmailDirect(payload),
    );
  }

  if (payload.batch && Array.isArray(payload.emails)) {
    const results = [];
    for (const email of payload.emails) {
      const res = await smtpCircuitBreaker.execute(() =>
        emailService.sendEmailDirect(email),
      );
      results.push({ to: email.to, success: true, ...res });
    }
    return results;
  }

  return smtpCircuitBreaker.execute(() =>
    emailService.sendEmailDirect(payload),
  );
}

/**
 * Obtiene métricas del estado de la cola y circuit breakers (Health Probes).
 */
function getQueueHealth() {
  const userDirectoryService = require("./userDirectoryService");

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
      usersService: userDirectoryService.usersCircuitBreaker.getStatus(),
    },
  };
}

/**
 * Cierre limpio de RabbitMQ para graceful shutdown.
 */
async function closeRabbitMQ() {
  clearMemoryQueue();
  try {
    if (rmqChannel) await rmqChannel.close();
  } catch (_err) {
    // ignorar error de cierre
  }
  try {
    if (rmqConnection) await rmqConnection.close();
  } catch (_err) {
    // ignorar error de cierre
  }
  rmqChannel = null;
  rmqConnection = null;
  isRmqConnected = false;
}

module.exports = {
  initRabbitMQ,
  isRabbitMQConnected,
  enqueuePush,
  enqueueEmail,
  processPushJob,
  processEmailJob,
  setCustomHandlers,
  clearMemoryQueue,
  isPermanentError,
  getRetryQueueName,
  RETRY_STEPS,
  fcmCircuitBreaker,
  smtpCircuitBreaker,
  getQueueHealth,
  closeRabbitMQ,
};
