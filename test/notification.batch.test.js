const { describe, it, before, after, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");

const app = require("../src/server");
const notificationQueue = require("../src/services/notificationQueue");
const notificationOrchestrator = require("../src/services/notificationOrchestrator");
const pushChannel = require("../src/services/channels/pushChannel");
const emailChannel = require("../src/services/channels/emailChannel");
const deviceTokenService = require("../src/services/deviceTokenService");
const pushService = require("../src/services/pushService");
const userDirectoryService = require("../src/services/userDirectoryService");
const CircuitBreaker = require("../src/security/circuitBreaker");

describe("Pruebas de Notificaciones Batch Multi-Canal, Fan-Out y Seguridad", () => {
  let server;
  let baseUrl;
  let originalServiceKey;
  let originalUserServiceUrl;
  let queuedPushJobs = [];
  let queuedEmailJobs = [];

  before(async () => {
    originalServiceKey = process.env.INTERNAL_SERVICE_API_KEY;
    originalUserServiceUrl = process.env.USER_SERVICE_URL;
    process.env.INTERNAL_SERVICE_API_KEY = "test-internal-service-secret";

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    process.env.INTERNAL_SERVICE_API_KEY = originalServiceKey;
    process.env.USER_SERVICE_URL = originalUserServiceUrl;
    notificationQueue.clearMemoryQueue();
    notificationQueue.setCustomHandlers({ pushHandler: null, emailHandler: null });
    notificationOrchestrator.clearIdempotencyCache();
    await notificationQueue.closeRabbitMQ();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    queuedPushJobs = [];
    queuedEmailJobs = [];
    notificationOrchestrator.clearIdempotencyCache();
    notificationQueue.clearMemoryQueue();

    notificationQueue.setCustomHandlers({
      pushHandler: async (job) => {
        queuedPushJobs.push(job);
        return { success: true };
      },
      emailHandler: async (job) => {
        queuedEmailJobs.push(job);
        return { success: true };
      },
    });
  });

  afterEach(() => {
    notificationQueue.clearMemoryQueue();
    notificationQueue.setCustomHandlers({ pushHandler: null, emailHandler: null });
  });

  async function requestJson(path, { method = "GET", headers = {}, body } = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, body: json };
  }

  it("GET /api/notifications/catalog requiere auth y retorna trip_alert_matched", async () => {
    const unauth = await requestJson("/api/notifications/catalog");
    assert.strictEqual(unauth.status, 401);

    const auth = await requestJson("/api/notifications/catalog", {
      headers: { "X-Service-Api-Key": "test-internal-service-secret" },
    });
    assert.strictEqual(auth.status, 200);
    assert.ok(Array.isArray(auth.body.types));
    assert.ok(auth.body.types.some((t) => t.type === "trip_alert_matched"));
  });

  it("POST /api/notifications/batch acepta userIds con X-Service-Api-Key, deduplica y aplica idempotencia", async () => {
    const payload = {
      idempotencyKey: "batch-trip-482",
      type: "trip_alert_matched",
      channels: ["push", "email"],
      sharedData: {
        tripId: "482",
        origin: "Madrid",
        destination: "Valencia",
        date: "15/11/2026",
        time: "08:30",
        price: "18 €",
      },
      userIds: ["u1", "u2", "u1", "u3"],
    };

    const first = await requestJson("/api/notifications/batch", {
      method: "POST",
      headers: { "X-Service-Api-Key": "test-internal-service-secret" },
      body: payload,
    });

    assert.strictEqual(first.status, 202);
    assert.strictEqual(first.body.success, true);
    assert.strictEqual(first.body.deduplicated, false);
    assert.strictEqual(first.body.totalRecipients, 3);
    assert.strictEqual(first.body.channels.push.status, "queued");
    assert.strictEqual(first.body.channels.email.status, "queued");

    const second = await requestJson("/api/notifications/batch", {
      method: "POST",
      headers: { "X-Service-Api-Key": "test-internal-service-secret" },
      body: payload,
    });

    assert.strictEqual(second.status, 202);
    assert.strictEqual(second.body.deduplicated, true);
    assert.strictEqual(second.body.batchId, first.body.batchId);
  });

  it("POST /api/notifications/batch permite ráfagas de servicio interno sin activar bulkNotificationLimiter (429)", async () => {
    const responses = [];
    for (let i = 0; i < 7; i++) {
      responses.push(
        await requestJson("/api/notifications/batch", {
          method: "POST",
          headers: { "X-Service-Api-Key": "test-internal-service-secret" },
          body: {
            type: "trip_alert_matched",
            channels: ["push"],
            sharedData: {
              tripId: `trip-${i}`,
              origin: "Madrid",
              destination: "Sevilla",
              date: "20/11/2026",
              time: "09:00",
              price: "25 €",
            },
            userIds: ["u1"],
          },
        }),
      );
    }

    assert.ok(responses.every((r) => r.status === 202));
  });

  it("POST /api/push/send/users encola lotes de userIds sin consultar Prisma en el HTTP handler", async () => {
    let prismaCalledDuringHttp = false;
    const orig = deviceTokenService.getActiveTokensByUserIds;
    deviceTokenService.getActiveTokensByUserIds = async () => {
      prismaCalledDuringHttp = true;
      return { tokens: [], tokensByUser: new Map() };
    };

    try {
      const res = await requestJson("/api/push/send/users", {
        method: "POST",
        headers: { "X-Service-Api-Key": "test-internal-service-secret" },
        body: {
          template: "trip_alert_matched",
          data: {
            tripId: "700",
            origin: "Málaga",
            destination: "Madrid",
            date: "21/11/2026",
            time: "07:00",
            price: "29 €",
          },
          userIds: ["u10", "u20", "u30"],
        },
      });

      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.body.recipientsCount, 3);
      assert.strictEqual(prismaCalledDuringHttp, false);
    } finally {
      deviceTokenService.getActiveTokensByUserIds = orig;
    }
  });

  it("POST /api/emails/send/batch y /batch/template realizan fan-out en múltiples jobs independientes", async () => {
    const rawBatch = await requestJson("/api/emails/send/batch", {
      method: "POST",
      headers: { "X-Service-Api-Key": "test-internal-service-secret" },
      body: {
        emails: [
          { to: "a@example.com", subject: "Hola A", html: "<p>A</p>" },
          { to: "b@example.com", subject: "Hola B", html: "<p>B</p>" },
          { to: "c@example.com", subject: "Hola C", html: "<p>C</p>" },
        ],
      },
    });

    assert.strictEqual(rawBatch.status, 202);
    assert.strictEqual(rawBatch.body.totalEmails, 3);
    assert.strictEqual(rawBatch.body.jobsQueued, 3);

    const tplBatch = await requestJson("/api/emails/send/batch/template", {
      method: "POST",
      headers: { "X-Service-Api-Key": "test-internal-service-secret" },
      body: {
        template: "trip_alert_matched",
        sharedData: {
          tripId: "900",
          origin: "Valencia",
          destination: "Barcelona",
          date: "22/11/2026",
          time: "16:00",
          price: "22 €",
        },
        userIds: ["u1", "u2"],
      },
    });

    assert.strictEqual(tplBatch.status, 202);
    assert.strictEqual(tplBatch.body.recipientsCount, 2);
  });

  it("Worker Push (processUsersBatchJob): consulta bulk 1 vez y divide 1200 tokens en chunks de 500", async () => {
    const origLookup = deviceTokenService.getActiveTokensByUserIds;
    const origSendTokens = pushService.sendToTokensDirect;

    let lookupCalls = 0;
    const sentChunkSizes = [];

    deviceTokenService.getActiveTokensByUserIds = async (ids) => {
      lookupCalls += 1;
      return {
        tokens: ids.map((id) => `fcm-${id}`),
        tokensByUser: new Map(),
      };
    };

    pushService.sendToTokensDirect = async (tokens) => {
      sentChunkSizes.push(tokens.length);
      return tokens.map((t) => ({ token: t, success: true, messageId: "m-1" }));
    };

    try {
      const userIds = Array.from({ length: 1200 }, (_, i) => `usr-${i}`);
      const breaker = new CircuitBreaker("TestFCM", { failureThreshold: 5 });

      const summary = await pushChannel.processUsersBatchJob(
        {
          userIds,
          title: "Nuevo viaje",
          body: "Madrid → Valencia",
          data: { tripId: "482" },
        },
        breaker,
      );

      assert.strictEqual(lookupCalls, 1);
      assert.deepStrictEqual(sentChunkSizes, [500, 500, 200]);
      assert.strictEqual(summary.totalTokens, 1200);
      assert.strictEqual(summary.chunksProcessed, 3);
      assert.strictEqual(summary.succeeded, 1200);
    } finally {
      deviceTokenService.getActiveTokensByUserIds = origLookup;
      pushService.sendToTokensDirect = origSendTokens;
    }
  });

  it("Worker Email (processLookupFanoutJob): resuelve emails contra ms-usuarios y hace fan-out individual", async () => {
    const origResolve = userDirectoryService.resolveUsersByIds;
    const origEnqueueEmail = notificationQueue.enqueueEmail;

    const enqueuedSingleEmails = [];
    userDirectoryService.resolveUsersByIds = async (ids) =>
      ids.map((id) => ({
        userId: id,
        email: `${id}@youconnext.es`,
        name: `Nombre ${id}`,
      }));

    // Interceptamos enqueueEmail para comprobar los jobs atómicos emitidos
    const emailChannelFresh = require("../src/services/channels/emailChannel");
    notificationQueue.enqueueEmail = async (payload) => {
      enqueuedSingleEmails.push(payload);
      return { jobId: `job-${payload.to}`, status: "queued" };
    };

    try {
      const result = await emailChannelFresh.processLookupFanoutJob({
        batchId: "batch-xyz",
        template: "trip_alert_matched",
        sharedData: {
          tripId: "482",
          origin: "Madrid",
          destination: "Valencia",
          date: "15/11/2026",
          time: "08:30",
          price: "18 €",
        },
        userIds: ["u1", "u2", "u3"],
      });

      assert.strictEqual(result.resolvedUsers, 3);
      assert.strictEqual(result.enqueuedEmails, 3);
      assert.strictEqual(enqueuedSingleEmails.length, 3);
      assert.strictEqual(enqueuedSingleEmails[0].to, "u1@youconnext.es");
      assert.strictEqual(enqueuedSingleEmails[0].template, "trip_alert_matched");
      assert.strictEqual(enqueuedSingleEmails[0].data.userName, "Nombre u1");
    } finally {
      userDirectoryService.resolveUsersByIds = origResolve;
      notificationQueue.enqueueEmail = origEnqueueEmail;
    }
  });

  it("userDirectoryService.resolveUsersByIds consulta ms-usuarios con X-Service-Api-Key y normaliza respuesta", async () => {
    process.env.USER_SERVICE_URL = "http://ms-usuarios.internal:3001";
    let capturedCall = null;

    const mockFetcher = async (url, options) => {
      capturedCall = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({
          users: [
            { id: "u1", email: "ana@example.com", name: "Ana" },
            { userId: "u2", email: "invalid-email", firstName: "Bad" },
            { userId: "u3", email: "luis@example.com", fullName: "Luis" },
          ],
        }),
      };
    };

    const resolved = await userDirectoryService.resolveUsersByIds(
      ["u1", "u2", "u3", "u1"],
      { fetcher: mockFetcher },
    );

    assert.strictEqual(
      capturedCall.url,
      "http://ms-usuarios.internal:3001/api/users/internal/batch",
    );
    assert.strictEqual(
      capturedCall.options.headers["X-Service-Api-Key"],
      "test-internal-service-secret",
    );
    assert.deepStrictEqual(JSON.parse(capturedCall.options.body), {
      userIds: ["u1", "u2", "u3"],
    });
    assert.strictEqual(resolved.length, 2, "Debe filtrar emails inválidos");
    assert.deepStrictEqual(resolved[0], {
      userId: "u1",
      email: "ana@example.com",
      name: "Ana",
    });
    assert.deepStrictEqual(resolved[1], {
      userId: "u3",
      email: "luis@example.com",
      name: "Luis",
    });
  });

  it("Aislamiento de canales (Bulkhead): si falla el canal Email, el canal Push sigue encolándose", async () => {
    const origEmailEnqueue = emailChannel.enqueueBatch;
    emailChannel.enqueueBatch = async () => {
      throw new Error("Fallo temporal simulado en canal email");
    };

    try {
      const result = await notificationOrchestrator.dispatchBatch({
        type: "trip_alert_matched",
        channels: ["push", "email"],
        sharedData: {
          tripId: "888",
          origin: "Madrid",
          destination: "Toledo",
          date: "25/11/2026",
          time: "11:00",
          price: "7 €",
        },
        userIds: ["u1", "u2"],
      });

      assert.strictEqual(result.status, "queued");
      assert.strictEqual(result.channels.push.status, "queued");
      assert.strictEqual(result.channels.email.status, "failed");
    } finally {
      emailChannel.enqueueBatch = origEmailEnqueue;
    }
  });
});
