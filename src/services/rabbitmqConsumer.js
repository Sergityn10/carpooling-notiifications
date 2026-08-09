const amqp = require("amqplib");
const config = require("../config");
const userEventHandler = require("../handlers/userEventHandler");
const suggestionEventHandler = require("../handlers/suggestionEventHandler");

const EXCHANGE = "carpooling_events";
const EXCHANGE_TYPE = "topic";

const QUEUE_USER = "notifications.user.events";
const ROUTING_KEY_USER = "user.*";

const QUEUE_SUGGESTION = "notifications.suggestion.events";
const ROUTING_KEY_SUGGESTION = "suggestion.*";

let connection = null;
let channel = null;
let reconnectTimer = null;
let isShuttingDown = false;

const ROUTING_KEY_HANDLERS = {
  "user.*": userEventHandler,
  "suggestion.*": suggestionEventHandler,
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
    console.log(
      "[RabbitMQ] Conectado a",
      config.rabbitmqUrl.replace(/\/\/.*@/, "//***@"),
    );

    connection.on("close", () => {
      if (!isShuttingDown) {
        console.warn("[RabbitMQ] Conexión cerrada, reintentando en 5s...");
        scheduleReconnect();
      }
    });

    connection.on("error", (err) => {
      console.error("[RabbitMQ] Error de conexión:", err.message);
    });

    channel = await connection.createChannel();

    await channel.assertExchange(EXCHANGE, EXCHANGE_TYPE, {
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

    channel.prefetch(1);

    console.log(
      `[RabbitMQ] Escuchando "${ROUTING_KEY_USER}" en "${QUEUE_USER}"`,
    );
    console.log(
      `[RabbitMQ] Escuchando "${ROUTING_KEY_SUGGESTION}" en "${QUEUE_SUGGESTION}"`,
    );

    channel.consume(
      userQueue.queue,
      (msg) => processMessage(msg, channel, "user.*"),
      { noAck: false },
    );

    channel.consume(
      suggestionQueue.queue,
      (msg) => processMessage(msg, channel, "suggestion.*"),
      { noAck: false },
    );
  } catch (error) {
    console.error("[RabbitMQ] Error al iniciar consumidor:", error.message);
    scheduleReconnect();
  }
}

async function processMessage(msg, ch, routingPattern) {
  if (!msg) return;

  try {
    const content = JSON.parse(msg.content.toString());
    const routingKey = msg.fields.routingKey;

    console.log(`[RabbitMQ] Evento recibido: ${routingKey}`, content);

    const handler = ROUTING_KEY_HANDLERS[routingPattern];

    if (handler && content.data) {
      await handler.handle(routingKey, content.data);
    } else {
      console.warn(`[RabbitMQ] No hay handler para routing key: ${routingKey}`);
    }

    ch.ack(msg);
  } catch (error) {
    console.error("[RabbitMQ] Error procesando mensaje:", error.message);
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

  console.log("[RabbitMQ] Consumidor detenido");
}

module.exports = { startConsumer, stopConsumer };
