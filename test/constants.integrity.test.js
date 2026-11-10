const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");

const constants = require("../src/constants");
const { NOTIFICATION_CATALOG } = require("../src/templates/notificationCatalog");
const templateService = require("../src/services/templateService");
const pushTemplateService = require("../src/services/pushTemplateService");
const tripEventHandler = require("../src/handlers/tripEventHandler");
const userEventHandler = require("../src/handlers/userEventHandler");
const emailService = require("../src/services/emailService");
const notificationQueue = require("../src/services/notificationQueue");
const notificationOrchestrator = require("../src/services/notificationOrchestrator");

describe("Pruebas de Integridad de Constantes y Contratos de Eventos", () => {
  it("Todas las colecciones de constantes exportadas deben ser profundamente inmutables", () => {
    assert.strictEqual(Object.isFrozen(constants.EXCHANGES), true);
    assert.strictEqual(Object.isFrozen(constants.QUEUES.DOMAIN), true);
    assert.strictEqual(Object.isFrozen(constants.QUEUES.DELIVERY), true);
    assert.strictEqual(Object.isFrozen(constants.INBOUND_EVENTS.TRIP), true);
    assert.strictEqual(Object.isFrozen(constants.OUTBOUND_EVENTS.INTERNAL_JOBS), true);
    assert.strictEqual(Object.isFrozen(constants.OUTBOUND_EVENTS.TELEMETRY), true);
    assert.strictEqual(Object.isFrozen(constants.NOTIFICATION_TYPES), true);
    assert.strictEqual(Object.isFrozen(constants.RETRY_POLICY.STEPS), true);

    assert.throws(() => {
      "use strict";
      constants.INBOUND_EVENTS.TRIP.ALERT_MATCHED = "mutated";
    }, TypeError);
  });

  it("Todos los eventos en EVENT_TO_NOTIFICATION_TYPE deben existir en NOTIFICATION_CATALOG y en sus plantillas", () => {
    for (const [eventName, notifType] of Object.entries(constants.EVENT_TO_NOTIFICATION_TYPE)) {
      const catalogEntry = NOTIFICATION_CATALOG[notifType];
      assert.ok(
        catalogEntry,
        `El evento '${eventName}' mapea a '${notifType}', que debe existir en NOTIFICATION_CATALOG`,
      );

      if (catalogEntry.emailTemplate) {
        assert.ok(
          templateService.TEMPLATES[catalogEntry.emailTemplate],
          `La plantilla Email '${catalogEntry.emailTemplate}' debe existir en templateService.TEMPLATES`,
        );
      }

      if (catalogEntry.pushTemplate) {
        assert.ok(
          pushTemplateService.PUSH_TEMPLATES[catalogEntry.pushTemplate],
          `La plantilla Push '${catalogEntry.pushTemplate}' debe existir en pushTemplateService.PUSH_TEMPLATES`,
        );
      }
    }
  });

  it("No deben existir colisiones entre nombres de colas ni entre eventos entrantes", () => {
    const queueNames = [
      ...Object.values(constants.QUEUES.DOMAIN),
      ...Object.values(constants.QUEUES.DELIVERY),
      constants.QUEUES.DLQ,
    ];
    assert.strictEqual(
      new Set(queueNames).size,
      queueNames.length,
      "Los nombres de colas deben ser únicos",
    );

    const inboundEventNames = [
      ...Object.values(constants.INBOUND_EVENTS.USER),
      ...Object.values(constants.INBOUND_EVENTS.SUGGESTION),
      ...Object.values(constants.INBOUND_EVENTS.ENTERPRISE),
      ...Object.values(constants.INBOUND_EVENTS.TRIP),
    ];
    assert.strictEqual(
      new Set(inboundEventNames).size,
      inboundEventNames.length,
      "Los nombres de eventos entrantes deben ser únicos",
    );
  });

  describe("Despacho de nuevos eventos mapeados con constantes", () => {
    let originalSendEmail;
    let sentEmails = [];
    let queuedEmailJobs = [];
    let queuedPushJobs = [];

    beforeEach(() => {
      sentEmails = [];
      queuedEmailJobs = [];
      queuedPushJobs = [];
      notificationOrchestrator.clearIdempotencyCache();
      notificationQueue.clearMemoryQueue();

      originalSendEmail = emailService.sendEmail;
      emailService.sendEmail = async (mailOptions) => {
        sentEmails.push(mailOptions);
        return { messageId: "mock-id", accepted: [mailOptions.to], rejected: [] };
      };

      notificationQueue.setCustomHandlers({
        pushHandler: async (job) => {
          queuedPushJobs.push(job.payload);
          return { success: true };
        },
        emailHandler: async (job) => {
          queuedEmailJobs.push(job.payload);
          return { success: true };
        },
      });
    });

    afterEach(() => {
      emailService.sendEmail = originalSendEmail;
      notificationQueue.clearMemoryQueue();
      notificationQueue.setCustomHandlers({ pushHandler: null, emailHandler: null });
      notificationOrchestrator.clearIdempotencyCache();
    });

    it("tripEventHandler debe soportar eventos de dominio trip.cancelled con userIds aunque userName se resuelva después", async () => {
      const res = await tripEventHandler.handle(constants.INBOUND_EVENTS.TRIP.CANCELLED, {
        tripId: "trip-777",
        origin: "Madrid",
        destination: "Granada",
        date: "01/12/2026",
        time: "10:00",
        reason: "Avería del vehículo",
        userIds: ["u-10", "u-11"],
      });

      await new Promise((r) => setImmediate(r));

      assert.strictEqual(res.type, constants.NOTIFICATION_TYPES.TRIP_CANCELLED);
      assert.strictEqual(res.status, "queued");
      assert.strictEqual(queuedEmailJobs.length, 1);
      assert.deepStrictEqual(queuedEmailJobs[0].userIds, ["u-10", "u-11"]);
    });

    it("tripEventHandler debe soportar trip.booked despachando push y email", async () => {
      const res = await tripEventHandler.handle(constants.INBOUND_EVENTS.TRIP.BOOKED, {
        tripId: "trip-888",
        passengerName: "Elena",
        origin: "Sevilla",
        destination: "Málaga",
        date: "02/12/2026",
        time: "17:30",
        seatsBooked: 2,
        seatsRemaining: 1,
        userId: "driver-42",
      });

      await new Promise((r) => setImmediate(r));

      assert.strictEqual(res.type, constants.NOTIFICATION_TYPES.TRIP_BOOKED);
      assert.strictEqual(queuedPushJobs.length, 1);
      assert.strictEqual(queuedEmailJobs.length, 1);
    });

    it("userEventHandler debe procesar user.password_reset_requested usando la plantilla password_reset", async () => {
      await userEventHandler.handle(constants.INBOUND_EVENTS.USER.PASSWORD_RESET_REQUESTED, {
        email: "sergio@youconnext.es",
        name: "Sergio",
        token: "reset-tok-123",
      });

      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, "sergio@youconnext.es");
      assert.ok(sentEmails[0].html.includes("reset-tok-123"));
    });
  });
});
