const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const rabbitmqConsumer = require("../src/services/rabbitmqConsumer");
const tripEventHandler = require("../src/handlers/tripEventHandler");
const notificationOrchestrator = require("../src/services/notificationOrchestrator");
const notificationQueue = require("../src/services/notificationQueue");

describe("Pruebas del Consumidor RabbitMQ de Trayectos (tripEventHandler)", () => {
  let enqueuedPushPayloads = [];
  let enqueuedEmailPayloads = [];

  beforeEach(() => {
    enqueuedPushPayloads = [];
    enqueuedEmailPayloads = [];
    notificationOrchestrator.clearIdempotencyCache();
    notificationQueue.clearMemoryQueue();

    notificationQueue.setCustomHandlers({
      pushHandler: async (job) => {
        enqueuedPushPayloads.push(job.payload);
        return { success: true };
      },
      emailHandler: async (job) => {
        enqueuedEmailPayloads.push(job.payload);
        return { success: true };
      },
    });
  });

  afterEach(() => {
    notificationQueue.clearMemoryQueue();
    notificationQueue.setCustomHandlers({ pushHandler: null, emailHandler: null });
    notificationOrchestrator.clearIdempotencyCache();
  });

  it("Debe registrar tripEventHandler bajo la routing key 'trip.*'", () => {
    assert.strictEqual(
      rabbitmqConsumer.ROUTING_KEY_HANDLERS["trip.*"],
      tripEventHandler,
    );
    assert.strictEqual(rabbitmqConsumer.QUEUE_TRIP, "notifications.trip.events");
    assert.strictEqual(rabbitmqConsumer.ROUTING_KEY_TRIP, "trip.*");
  });

  it("processMessage: Debe procesar trip.alert.matched con user_ids (snake_case), hacer fan-out Push + Email y confirmar ack", async () => {
    let ackCalled = false;
    let nackCalled = false;

    const mockChannel = {
      ack: () => {
        ackCalled = true;
      },
      nack: () => {
        nackCalled = true;
      },
    };

    const mockMsg = {
      fields: { routingKey: "trip.alert.matched" },
      content: Buffer.from(
        JSON.stringify({
          event: "trip.alert.matched",
          source: "carpooling-trips",
          data: {
            trip_id: "trip-901",
            origin: "Madrid",
            destination: "Valencia",
            date: "28/11/2026",
            time: "08:00",
            price: 18,
            available_seats: 3,
            driver_name: "Marta",
            user_ids: ["usr-1", "usr-2", "usr-1", "usr-3"],
          },
        }),
      ),
    };

    await rabbitmqConsumer.processMessage(mockMsg, mockChannel, "trip.*");
    // Cedemos un tick para que el memory worker de pruebas consuma el enqueue
    await new Promise((r) => setImmediate(r));

    assert.strictEqual(ackCalled, true);
    assert.strictEqual(nackCalled, false);
    assert.strictEqual(enqueuedPushPayloads.length, 1);
    assert.strictEqual(enqueuedEmailPayloads.length, 1);
    assert.deepStrictEqual(enqueuedPushPayloads[0].userIds, ["usr-1", "usr-2", "usr-3"]);
    assert.strictEqual(enqueuedPushPayloads[0].jobKind, "users_batch");
    assert.strictEqual(enqueuedEmailPayloads[0].jobKind, "users_lookup_fanout");
    assert.strictEqual(enqueuedEmailPayloads[0].sharedData.price, "18 €");
  });

  it("processMessage: Debe omitir y confirmar (ack) si trip.alert.matched llega sin userIds", async () => {
    let ackCalled = false;
    const mockChannel = {
      ack: () => {
        ackCalled = true;
      },
      nack: () => {},
    };

    const mockMsg = {
      fields: { routingKey: "trip.alert.matched" },
      content: Buffer.from(
        JSON.stringify({
          data: {
            tripId: "trip-empty",
            origin: "Madrid",
            destination: "Valencia",
            date: "28/11/2026",
            time: "08:00",
            price: "15 €",
            userIds: [],
          },
        }),
      ),
    };

    await rabbitmqConsumer.processMessage(mockMsg, mockChannel, "trip.*");
    assert.strictEqual(ackCalled, true);
    assert.strictEqual(enqueuedPushPayloads.length, 0);
    assert.strictEqual(enqueuedEmailPayloads.length, 0);
  });

  it("processMessage: Debe enviar nack cuando falta algún dato obligatorio del trayecto", async () => {
    let ackCalled = false;
    let nackCalled = false;

    const mockChannel = {
      ack: () => {
        ackCalled = true;
      },
      nack: () => {
        nackCalled = true;
      },
    };

    const mockMsg = {
      fields: { routingKey: "trip.alert.matched" },
      content: Buffer.from(
        JSON.stringify({
          data: {
            tripId: "trip-bad",
            userIds: ["usr-1"],
            // faltan origin, destination, date, time, price
          },
        }),
      ),
    };

    await rabbitmqConsumer.processMessage(mockMsg, mockChannel, "trip.*");
    assert.strictEqual(ackCalled, false);
    assert.strictEqual(nackCalled, true);
  });
});
