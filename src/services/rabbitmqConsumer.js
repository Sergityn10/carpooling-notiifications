const amqp = require("amqplib");
const config = require("../config");
const {
  EXCHANGES,
  EXCHANGE_TYPES,
  QUEUES,
  ROUTING_KEYS,
} = require("../constants");
const userEventHandler = require("../handlers/userEventHandler");
const suggestionEventHandler = require("../handlers/suggestionEventHandler");
const enterpriseEventHandler = require("../handlers/enterpriseEventHandler");
const tripEventHandler = require("../handlers/tripEventHandler");

const EXCHANGE = EXCHANGES.DOMAIN_EVENTS;
const EXCHANGE_TYPE = EXCHANGE_TYPES.TOPIC;
const DLQ_EXCHANGE = EXCHANGES.DLQ;

const QUEUE_USER = QUEUES.DOMAIN.USER;
const ROUTING_KEY_USER = ROUTING_KEYS.DOMAIN_PATTERNS.USER;

const QUEUE_SUGGESTION = QUEUES.DOMAIN.SUGGESTION;
const ROUTING_KEY_SUGGESTION = ROUTING_KEYS.DOMAIN_PATTERNS.SUGGESTION;

const QUEUE_ENTERPRISE = QUEUES.DOMAIN.ENTERPRISE;
const ROUTING_KEY_ENTERPRISE = ROUTING_KEYS.DOMAIN_PATTERNS.ENTERPRISE;

const QUEUE_TRIP = QUEUES.DOMAIN.TRIP;
const ROUTING_KEY_TRIP = ROUTING_KEYS.DOMAIN_PATTERNS.TRIP;

let connection = null;
let channel = null;
let reconnectTimer = null;
let isShuttingDown = false;
let isConnected = false;
let lastConnectedAt = null;
let lastError = null;

const ROUTING_KEY_HANDLERS = {
  [ROUTING_KEY_USER]: userEventHandler,
  [ROUTING_KEY_SUGGESTION]: suggestionEventHandler,
  [ROUTING_KEY_ENTERPRISE]: enterpriseEventHandler,
  [ROUTING_KEY_TRIP]: tripEventHandler,
};

async function startConsumer() {
  if (!config.rabbitmqUrl) {
    console.warn(
      "[RabbitMQ] RABBITMQ_URL no configurada, consumidor desactivado",
    );
    return;
  }

  try {
    connection = await amqp.connect(config.rabbitmqUrl);
    isConnected = true;
    lastConnectedAt = new Date().toISOString();
    lastError = null;
    console.log(
      "[RabbitMQ] Conectado a",
      config.rabbitmqUrl.replace(/\/\/.*@/, "//***@"),
    );

    connection.on("close", () => {
      isConnected = false;
      if (!isShuttingDown) {
        console.warn("[RabbitMQ] Conexión cerrada, reintentando en 5s...");
        scheduleReconnect();
      }
    });

    connection.on("error", (err) => {
      isConnected = false;
      lastError = err.message;
      console.error("[RabbitMQ] Error de conexión:", err.message);
    });

    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, {
      durable: true,
    });
    await channel.assertExchange(DLQ_EXCHANGE, EXCHANGE_TYPES.DIRECT, {
      durable: true,
    });

    const userQueue = await channel.assertQueue(QUEUE_USER, { durable: true });
    await channel.bindQueue(userQueue.queue, EXCHANGE, ROUTING_KEY_USER);

    const suggestionQueue = await channel.assertQueue(QUEUE_SUGGESTION, {
      durable: true,
    });
    await channel.bindQueue(
      suggestionQueue.queue,
      EXCHANGE,
      ROUTING_KEY_SUGGESTION,
    );

    const enterpriseQueue = await channel.assertQueue(QUEUE_ENTERPRISE, {
      durable: true,
    });
    await channel.bindQueue(
      enterpriseQueue.queue,
      EXCHANGE,
      ROUTING_KEY_ENTERPRISE,
    );

    const tripQueue = await channel.assertQueue(QUEUE_TRIP, {
      durable: true,
      arguments: {
        "x-dead-letter-exchange": DLQ_EXCHANGE,
        "x-dead-letter-routing-key": ROUTING_KEYS.DLQ,
      },
    });
    await channel.bindQueue(tripQueue.queue, EXCHANGE, ROUTING_KEY_TRIP);

    channel.prefetch(10);

    console.log(
      `[RabbitMQ] Escuchando "${ROUTING_KEY_USER}" en "${QUEUE_USER}"`,
    );
    console.log(
      `[RabbitMQ] Escuchando "${ROUTING_KEY_SUGGESTION}" en "${QUEUE_SUGGESTION}"`,
    );
    console.log(
      `[RabbitMQ] Escuchando "${ROUTING_KEY_ENTERPRISE}" en "${QUEUE_ENTERPRISE}"`,
    );
    console.log(
      `[RabbitMQ] Escuchando "${ROUTING_KEY_TRIP}" en "${QUEUE_TRIP}"`,
    );

    channel.consume(
      userQueue.queue,
      (msg) => processMessage(msg, channel, ROUTING_KEY_USER),
      { noAck: false },
    );

    channel.consume(
      suggestionQueue.queue,
      (msg) => processMessage(msg, channel, ROUTING_KEY_SUGGESTION),
      { noAck: false },
    );

    channel.consume(
      enterpriseQueue.queue,
      (msg) => processMessage(msg, channel, ROUTING_KEY_ENTERPRISE),
      { noAck: false },
    );

    channel.consume(
      tripQueue.queue,
      (msg) => processMessage(msg, channel, ROUTING_KEY_TRIP),
      { noAck: false },
    );
  } catch (error) {
    isConnected = false;
    lastError = error.message;
    console.error("[RabbitMQ] Error al iniciar consumidor:", error.message);
    scheduleReconnect();
  }
}

async function processMessage(msg, ch, routingPattern) {
  if (!msg) return;

  try {
    const content = JSON.parse(msg.content.toString());
    const routingKey = msg.fields.routingKey;

    console.log(`[RabbitMQ] Evento recibido: ${routingKey}`);

    const handler = ROUTING_KEY_HANDLERS[routingPattern];
    const eventData = content.data !== undefined ? content.data : content;

    if (handler && eventData) {
      await handler.handle(routingKey, eventData);
    } else {
      console.warn(`[RabbitMQ] No hay handler o datos para routing key: ${routingKey}`);
    }

    ch.ack(msg);
  } catch (error) {
    console.error("[RabbitMQ] Error procesando mensaje:", error.message);

    if (routingPattern !== ROUTING_KEY_TRIP && typeof ch.publish === "function") {
      try {
        ch.publish(DLQ_EXCHANGE, ROUTING_KEYS.DLQ, msg.content, {
          persistent: true,
          headers: {
            "x-original-routing-key": msg.fields?.routingKey || routingPattern,
            "x-error": error.message,
          },
        });
      } catch (_dlqErr) {
        // Ignorar fallo secundario al publicar a DLQ
      }
    }

    ch.nack(msg, false, false);
  }
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);
  if (isShuttingDown) return;

  reconnectTimer = setTimeout(() => {
    console.log("[RabbitMQ] Reintentando conexión...");
    startConsumer();
  }, 5000);
}

async function stopConsumer() {
  isShuttingDown = true;
  if (reconnectTimer) clearTimeout(reconnectTimer);

  try {
    if (channel) await channel.close();
  } catch (err) {
    console.error("[RabbitMQ] Error cerrando canal:", err.message);
  }

  try {
    if (connection) await connection.close();
  } catch (err) {
    console.error("[RabbitMQ] Error cerrando conexión:", err.message);
  }

  isConnected = false;
  console.log("[RabbitMQ] Consumidor detenido");
}

function getConsumerStatus() {
  return {
    configured: Boolean(config.rabbitmqUrl),
    connected: Boolean(isConnected && channel),
    lastConnectedAt,
    lastError,
    queues: [QUEUE_USER, QUEUE_SUGGESTION, QUEUE_ENTERPRISE, QUEUE_TRIP],
  };
}

module.exports = {
  startConsumer,
  stopConsumer,
  processMessage,
  getConsumerStatus,
  ROUTING_KEY_HANDLERS,
  QUEUE_ENTERPRISE,
  ROUTING_KEY_ENTERPRISE,
  QUEUE_TRIP,
  ROUTING_KEY_TRIP,
};
