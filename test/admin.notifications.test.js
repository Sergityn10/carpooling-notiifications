const {
  describe,
  it,
  before,
  after,
  beforeEach,
  afterEach,
} = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

const app = require("../src/server");
const config = require("../src/config");
const prisma = require("../src/lib/prisma");
const emailService = require("../src/services/emailService");
const pushService = require("../src/services/pushService");
const deviceTokenService = require("../src/services/deviceTokenService");
const userDirectoryService = require("../src/services/userDirectoryService");
const notificationQueue = require("../src/services/notificationQueue");
const adminNotificationService = require("../src/services/adminNotificationService");

describe("Pruebas del Módulo Admin de Estado de la API y Notificaciones (SOLO ADMIN)", () => {
  let server;
  let baseUrl;
  let rsaPrivateKey;
  let rsaPublicKey;
  let adminToken;
  let userToken;
  let driverToken;

  const savedEnv = {};
  const savedOriginals = {};

  function signJwt(payload) {
    return jwt.sign(payload, rsaPrivateKey, {
      algorithm: "RS256",
      expiresIn: "1h",
    });
  }

  async function requestJson(path, { method = "GET", token, headers = {}, body } = {}) {
    const reqHeaders = {
      "Content-Type": "application/json",
      ...headers,
    };
    if (token) {
      reqHeaders.Authorization = `Bearer ${token}`;
    }

    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: reqHeaders,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = await res.json();
    return { status: res.status, body: json };
  }

  before(async () => {
    for (const key of [
      "JWT_PUBLIC_KEY",
      "USER_SERVICE_URL",
      "ALLOW_DEVICE_EMAIL_FALLBACK",
      "SMTP_HOST",
      "SMTP_USER",
      "SMTP_PASS",
      "FIREBASE_PROJECT_ID",
      "FIREBASE_CLIENT_EMAIL",
      "FIREBASE_PRIVATE_KEY",
      "RABBITMQ_URL",
    ]) {
      savedEnv[key] = process.env[key];
    }

    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    rsaPrivateKey = keyPair.privateKey;
    rsaPublicKey = keyPair.publicKey;
    process.env.JWT_PUBLIC_KEY = rsaPublicKey;

    adminToken = signJwt({
      userId: "admin-1",
      email: "admin@youconnext.es",
      role: "admin",
    });
    userToken = signJwt({
      userId: "user-1",
      email: "user@youconnext.es",
      role: "user",
    });
    driverToken = signJwt({
      userId: "driver-1",
      email: "driver@youconnext.es",
      role: "driver",
    });

    await new Promise((resolve) => {
      server = app.listen(0, () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
    });
  });

  after(async () => {
    for (const [key, val] of Object.entries(savedEnv)) {
      if (val === undefined) delete process.env[key];
      else process.env[key] = val;
    }

    notificationQueue.clearMemoryQueue();
    notificationQueue.setCustomHandlers({ pushHandler: null, emailHandler: null });
    adminNotificationService.clearAdminHistory();
    await notificationQueue.closeRabbitMQ();

    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  beforeEach(() => {
    adminNotificationService.clearAdminHistory();
    notificationQueue.clearMemoryQueue();

    savedOriginals.$queryRaw = prisma.$queryRaw;
    savedOriginals.verifyConnection = emailService.verifyConnection;
    savedOriginals.sendEmailDirect = emailService.sendEmailDirect;
    savedOriginals.sendTemplatedEmailDirect = emailService.sendTemplatedEmailDirect;
    savedOriginals.initFirebase = pushService.initFirebase;
    savedOriginals.isInitialized = pushService.isInitialized;
    savedOriginals.sendToTokensDirect = pushService.sendToTokensDirect;
    savedOriginals.getDeviceTokenStats = deviceTokenService.getDeviceTokenStats;
    savedOriginals.findActiveTargetsByFilter =
      deviceTokenService.findActiveTargetsByFilter;
    savedOriginals.listDeviceTokensPaginated =
      deviceTokenService.listDeviceTokensPaginated;
    savedOriginals.getKnownEmailsByUserIds =
      deviceTokenService.getKnownEmailsByUserIds;
    savedOriginals.resolveUsersByIds = userDirectoryService.resolveUsersByIds;
    savedOriginals.listUsersByFilter = userDirectoryService.listUsersByFilter;
    savedOriginals.checkUserServiceHealth =
      userDirectoryService.checkUserServiceHealth;
    savedOriginals.maxSyncRecipients = config.adminNotifications.maxSyncRecipients;
    savedOriginals.rabbitmqUrl = config.rabbitmqUrl;
  });

  afterEach(() => {
    prisma.$queryRaw = savedOriginals.$queryRaw;
    emailService.verifyConnection = savedOriginals.verifyConnection;
    emailService.sendEmailDirect = savedOriginals.sendEmailDirect;
    emailService.sendTemplatedEmailDirect = savedOriginals.sendTemplatedEmailDirect;
    pushService.initFirebase = savedOriginals.initFirebase;
    pushService.isInitialized = savedOriginals.isInitialized;
    pushService.sendToTokensDirect = savedOriginals.sendToTokensDirect;
    deviceTokenService.getDeviceTokenStats = savedOriginals.getDeviceTokenStats;
    deviceTokenService.findActiveTargetsByFilter =
      savedOriginals.findActiveTargetsByFilter;
    deviceTokenService.listDeviceTokensPaginated =
      savedOriginals.listDeviceTokensPaginated;
    deviceTokenService.getKnownEmailsByUserIds =
      savedOriginals.getKnownEmailsByUserIds;
    userDirectoryService.resolveUsersByIds = savedOriginals.resolveUsersByIds;
    userDirectoryService.listUsersByFilter = savedOriginals.listUsersByFilter;
    userDirectoryService.checkUserServiceHealth =
      savedOriginals.checkUserServiceHealth;
    config.adminNotifications.maxSyncRecipients = savedOriginals.maxSyncRecipients;
    config.rabbitmqUrl = savedOriginals.rabbitmqUrl;
    notificationQueue.setCustomHandlers({ pushHandler: null, emailHandler: null });
    notificationQueue.clearMemoryQueue();
  });

  describe("Seguridad y Control de Acceso (SOLO ADMIN)", () => {
    const endpoints = [
      { method: "GET", path: "/api/admin/notifications/status" },
      { method: "GET", path: "/api/admin/notifications/history" },
      { method: "GET", path: "/api/admin/notifications/jobs/abc" },
      { method: "GET", path: "/api/admin/notifications/recipients" },
      { method: "POST", path: "/api/admin/notifications/preview", body: { target: { type: "all" } } },
      {
        method: "POST",
        path: "/api/admin/notifications/email",
        body: { target: { type: "single", email: "a@b.com" }, subject: "s", message: "m" },
      },
      {
        method: "POST",
        path: "/api/admin/notifications/push",
        body: { target: { type: "all" }, title: "t", body: "b" },
      },
      {
        method: "POST",
        path: "/api/admin/notifications/send",
        body: { target: { type: "all" }, channels: ["push"], push: { title: "t", body: "b" } },
      },
    ];

    it("Debe rechazar con 401 si no se envía token Bearer", async () => {
      for (const ep of endpoints) {
        const res = await requestJson(ep.path, { method: ep.method, body: ep.body });
        assert.strictEqual(res.status, 401, `${ep.method} ${ep.path} debe exigir auth`);
      }
    });

    it("Debe rechazar con 403 FORBIDDEN a usuarios con rol 'user' o 'driver'", async () => {
      for (const ep of endpoints) {
        const resUser = await requestJson(ep.path, {
          method: ep.method,
          token: userToken,
          body: ep.body,
        });
        assert.strictEqual(
          resUser.status,
          403,
          `${ep.method} ${ep.path} debe bloquear role='user'`,
        );
        assert.strictEqual(resUser.body.code, "FORBIDDEN");

        const resDriver = await requestJson(ep.path, {
          method: ep.method,
          token: driverToken,
          body: ep.body,
        });
        assert.strictEqual(
          resDriver.status,
          403,
          `${ep.method} ${ep.path} debe bloquear role='driver'`,
        );
      }
    });
  });

  describe("Estado de la API (GET /api/admin/notifications/status)", () => {
    it("Retorna overallStatus='healthy' cuando BD, SMTP y Firebase están operativos y sin filtrar secretos", async () => {
      process.env.SMTP_HOST = "smtppro.zoho.eu";
      process.env.SMTP_USER = "noreply@youconnext.es";
      process.env.SMTP_PASS = "super-secret-smtp-pass";
      process.env.FIREBASE_PROJECT_ID = "youconnext-test";
      process.env.FIREBASE_CLIENT_EMAIL = "fcm@youconnext-test.iam.gserviceaccount.com";
      process.env.FIREBASE_PRIVATE_KEY = "super-secret-private-key";
      delete process.env.RABBITMQ_URL;
      config.rabbitmqUrl = "";

      prisma.$queryRaw = async () => [{ 1: 1 }];
      emailService.verifyConnection = async () => true;
      pushService.initFirebase = () => ({});
      pushService.isInitialized = () => true;
      deviceTokenService.getDeviceTokenStats = async () => ({
        total: 12,
        active: 10,
        inactive: 2,
        uniqueActiveUsers: 8,
        byPlatform: { android: 7, ios: 3 },
        byRole: { user: 9, admin: 1 },
      });

      const res = await requestJson("/api/admin/notifications/status", {
        token: adminToken,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.overallStatus, "healthy");
      assert.strictEqual(res.body.checks.database.ok, true);
      assert.strictEqual(res.body.checks.smtp.ok, true);
      assert.strictEqual(res.body.checks.firebase.ok, true);
      assert.strictEqual(res.body.deviceTokens.active, 10);
      assert.strictEqual(res.body.deviceTokens.uniqueActiveUsers, 8);
      assert.deepStrictEqual(res.body.issues, []);

      const serialized = JSON.stringify(res.body);
      assert.ok(!serialized.includes("super-secret-smtp-pass"));
      assert.ok(!serialized.includes("super-secret-private-key"));
    });

    it("Retorna overallStatus='degraded' si SMTP falla pero Firebase y BD están operativos", async () => {
      process.env.SMTP_HOST = "smtppro.zoho.eu";
      process.env.SMTP_USER = "noreply@youconnext.es";
      process.env.SMTP_PASS = "pass";
      process.env.FIREBASE_PROJECT_ID = "youconnext-test";
      process.env.FIREBASE_CLIENT_EMAIL = "fcm@youconnext.iam.gserviceaccount.com";
      process.env.FIREBASE_PRIVATE_KEY = "key";

      prisma.$queryRaw = async () => [{ 1: 1 }];
      emailService.verifyConnection = async () => {
        throw new Error("535 Authentication Failed");
      };
      pushService.initFirebase = () => ({});
      pushService.isInitialized = () => true;
      deviceTokenService.getDeviceTokenStats = async () => ({
        total: 1,
        active: 1,
        inactive: 0,
        uniqueActiveUsers: 1,
        byPlatform: { android: 1 },
        byRole: { admin: 1 },
      });

      const res = await requestJson("/api/admin/notifications/status", {
        token: adminToken,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.overallStatus, "degraded");
      assert.strictEqual(res.body.checks.smtp.ok, false);
      assert.ok(res.body.checks.smtp.error.includes("535 Authentication Failed"));
      assert.strictEqual(res.body.checks.firebase.ok, true);
      assert.ok(res.body.issues.some((msg) => msg.includes("SMTP")));
    });

    it("Retorna overallStatus='unhealthy' si la base de datos falla", async () => {
      prisma.$queryRaw = async () => {
        throw new Error("ECONNREFUSED MySQL");
      };
      emailService.verifyConnection = async () => true;
      pushService.initFirebase = () => ({});
      pushService.isInitialized = () => true;
      deviceTokenService.getDeviceTokenStats = async () => {
        throw new Error("DB down");
      };

      const res = await requestJson("/api/admin/notifications/status", {
        token: adminToken,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.overallStatus, "unhealthy");
      assert.strictEqual(res.body.checks.database.ok, false);
    });

    it("Incluye estado de ms-usuarios cuando checkUserService=true", async () => {
      prisma.$queryRaw = async () => [{ 1: 1 }];
      emailService.verifyConnection = async () => true;
      pushService.initFirebase = () => ({});
      pushService.isInitialized = () => true;
      deviceTokenService.getDeviceTokenStats = async () => ({
        total: 0,
        active: 0,
        inactive: 0,
        uniqueActiveUsers: 0,
        byPlatform: {},
        byRole: {},
      });
      userDirectoryService.checkUserServiceHealth = async () => ({
        configured: true,
        ok: true,
        statusCode: 200,
        latencyMs: 12,
      });

      const res = await requestJson(
        "/api/admin/notifications/status?checkUserService=true",
        { token: adminToken },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.checks.userService.health.ok, true);
      assert.strictEqual(res.body.checks.userService.health.statusCode, 200);
    });
  });

  describe("Selector de Destinatarios y Previsualización", () => {
    it("GET /recipients lista dispositivos paginados sin exponer tokens FCM", async () => {
      deviceTokenService.listDeviceTokensPaginated = async (opts) => {
        assert.strictEqual(opts.role, "driver");
        assert.strictEqual(opts.platform, "android");
        return {
          items: [
            {
              id: "dev-1",
              userId: "u-99",
              email: "driver99@youconnext.es",
              role: "driver",
              platform: "android",
              deviceName: "Pixel 8",
              active: true,
            },
          ],
          pagination: { page: 1, limit: 25, total: 1, totalPages: 1 },
        };
      };

      const res = await requestJson(
        "/api/admin/notifications/recipients?role=driver&platform=android",
        { token: adminToken },
      );

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.items.length, 1);
      assert.strictEqual(res.body.items[0].email, "driver99@youconnext.es");
      assert.strictEqual(res.body.items[0].token, undefined);
    });

    it("POST /preview calcula alcance de push y email para filtro 'all'", async () => {
      delete process.env.USER_SERVICE_URL;
      deviceTokenService.findActiveTargetsByFilter = async () => ({
        tokens: ["t-1", "t-2", "t-3"],
        users: [
          { userId: "u-1", email: "u1@youconnext.es", role: "user" },
          { userId: "u-2", email: "u2@youconnext.es", role: "driver" },
        ],
        totalDevices: 3,
        uniqueUsers: 2,
        byPlatform: { android: 2, ios: 1 },
      });

      const res = await requestJson("/api/admin/notifications/preview", {
        method: "POST",
        token: adminToken,
        body: {
          channels: ["push", "email"],
          target: { type: "all", fallbackToDeviceTokens: true },
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.preview.push.totalDevices, 3);
      assert.strictEqual(res.body.preview.push.uniqueUsers, 2);
      assert.strictEqual(res.body.preview.email.totalRecipients, 2);
      assert.strictEqual(
        res.body.preview.email.recipientSource,
        "device_tokens_fallback",
      );
    });
  });

  describe("Envío Personalizado de Correos (POST /api/admin/notifications/email)", () => {
    it("Envía un email personalizado síncrono a un usuario particular con escape anti-XSS y lo registra en historial", async () => {
      const sentPayloads = [];
      emailService.sendTemplatedEmailDirect = async (payload) => {
        sentPayloads.push(payload);
        return {
          messageId: "msg-admin-1",
          accepted: [payload.to],
          rejected: [],
        };
      };

      const res = await requestJson("/api/admin/notifications/email", {
        method: "POST",
        token: adminToken,
        body: {
          target: {
            type: "single",
            email: "sergio@youconnext.es",
            name: "Sergio",
          },
          subject: "Prueba Admin <script>alert(1)</script>",
          title: "Verificación SMTP",
          message: "Línea 1 <img src=x onerror=alert(1)>\nLínea 2",
          ctaText: "Ir al panel",
          ctaUrl: "https://admin.youconnext.es",
          sync: true,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);
      assert.strictEqual(res.body.mode, "sync");
      assert.strictEqual(res.body.succeeded, 1);
      assert.strictEqual(sentPayloads.length, 1);
      assert.strictEqual(sentPayloads[0].template, "admin_custom");

      const templateService = require("../src/services/templateService");
      const rendered = templateService.renderTemplate("admin_custom", {
        ...sentPayloads[0].data,
        userName: "Sergio",
      });
      assert.ok(rendered.html.includes("Línea 1 &lt;img"));
      assert.ok(rendered.html.includes("<br />Línea 2"));
      assert.ok(!rendered.html.includes("<script>"));
      assert.ok(rendered.html.includes("https://admin.youconnext.es"));

      const jobRes = await requestJson(
        `/api/admin/notifications/jobs/${res.body.batchId}`,
        { token: adminToken },
      );
      assert.strictEqual(jobRes.status, 200);
      assert.strictEqual(jobRes.body.job.status, "completed");
      assert.strictEqual(jobRes.body.job.requestedBy.email, "admin@youconnext.es");
    });

    it("Envía emails en lote asíncrono a 'all' resolviendo desde ms-usuarios cuando está configurado", async () => {
      process.env.USER_SERVICE_URL = "http://ms-usuarios.internal:3001";
      const queuedJobs = [];
      notificationQueue.setCustomHandlers({
        emailHandler: async (job) => {
          queuedJobs.push(job.payload);
          return { success: true };
        },
      });

      userDirectoryService.listUsersByFilter = async () => [
        { userId: "u-1", email: "ana@youconnext.es", name: "Ana", role: "user" },
        { userId: "u-2", email: "luis@youconnext.es", name: "Luis", role: "driver" },
        { userId: "u-3", email: "ANA@youconnext.es", name: "Ana dup", role: "user" },
      ];

      const res = await requestJson("/api/admin/notifications/email", {
        method: "POST",
        token: adminToken,
        body: {
          target: { type: "all" },
          subject: "Aviso general",
          message: "Hola a toda la comunidad.",
        },
      });

      await new Promise((r) => setImmediate(r));

      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.body.mode, "async");
      assert.strictEqual(res.body.recipientSource, "user_service");
      assert.strictEqual(res.body.recipientsCount, 2);
      assert.strictEqual(res.body.jobsQueued, 2);
      assert.strictEqual(queuedJobs.length, 2);
    });

    it("Rechaza sync=true cuando se supera maxSyncRecipients", async () => {
      config.adminNotifications.maxSyncRecipients = 2;
      process.env.USER_SERVICE_URL = "http://ms-usuarios.internal:3001";
      userDirectoryService.listUsersByFilter = async () => [
        { userId: "u-1", email: "u1@youconnext.es" },
        { userId: "u-2", email: "u2@youconnext.es" },
        { userId: "u-3", email: "u3@youconnext.es" },
      ];

      const res = await requestJson("/api/admin/notifications/email", {
        method: "POST",
        token: adminToken,
        body: {
          target: { type: "all" },
          subject: "Test",
          message: "Mensaje",
          sync: true,
        },
      });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.code, "SYNC_LIMIT_EXCEEDED");
    });
  });

  describe("Envío Personalizado de Notificaciones Push (POST /api/admin/notifications/push)", () => {
    it("Envía push síncrono a un usuario concreto con resultados detallados por dispositivo", async () => {
      deviceTokenService.findActiveTargetsByFilter = async (filter) => {
        assert.strictEqual(filter.userId, "user-42");
        return {
          tokens: ["fcm-token-11111111111111", "fcm-token-22222222222222"],
          users: [{ userId: "user-42", email: "u42@youconnext.es", role: "user" }],
          totalDevices: 2,
          uniqueUsers: 1,
          byPlatform: { android: 1, ios: 1 },
        };
      };

      pushService.sendToTokensDirect = async (tokens, payload) => {
        assert.strictEqual(payload.title, "Test Push");
        assert.strictEqual(payload.body, "Todo funciona correctamente");
        return [
          { token: tokens[0], success: true, messageId: "fcm-msg-1" },
          {
            token: tokens[1],
            success: false,
            errorCode: "messaging/registration-token-not-registered",
            error: "NotRegistered",
          },
        ];
      };

      const res = await requestJson("/api/admin/notifications/push", {
        method: "POST",
        token: adminToken,
        body: {
          target: { type: "single", userId: "user-42" },
          title: "Test Push",
          body: "Todo funciona correctamente",
          sync: true,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.mode, "sync");
      assert.strictEqual(res.body.status, "partial");
      assert.strictEqual(res.body.succeeded, 1);
      assert.strictEqual(res.body.failed, 1);
      assert.strictEqual(res.body.results[0].tokenPreview, "fcm-to...111111");
    });

    it("Retorna 404 si el usuario concreto no tiene dispositivos activos registrados", async () => {
      deviceTokenService.findActiveTargetsByFilter = async () => ({
        tokens: [],
        users: [],
        totalDevices: 0,
        uniqueUsers: 0,
        byPlatform: {},
      });

      const res = await requestJson("/api/admin/notifications/push", {
        method: "POST",
        token: adminToken,
        body: {
          target: { type: "single", userId: "user-sin-dispositivos" },
          title: "Hola",
          body: "Prueba",
          sync: true,
        },
      });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.code, "NO_ACTIVE_DEVICES_FOUND");
    });

    it("Encola push masivo filtrado por role y platform", async () => {
      const queuedPushJobs = [];
      notificationQueue.setCustomHandlers({
        pushHandler: async (job) => {
          queuedPushJobs.push(job.payload);
          return { success: true };
        },
      });

      deviceTokenService.findActiveTargetsByFilter = async (filter) => {
        assert.strictEqual(filter.role, "driver");
        assert.strictEqual(filter.platform, "android");
        return {
          tokens: ["tok-a", "tok-b"],
          users: [
            { userId: "d-1", email: "d1@youconnext.es", role: "driver" },
            { userId: "d-2", email: "d2@youconnext.es", role: "driver" },
          ],
          totalDevices: 2,
          uniqueUsers: 2,
          byPlatform: { android: 2 },
        };
      };

      const res = await requestJson("/api/admin/notifications/push", {
        method: "POST",
        token: adminToken,
        body: {
          target: { type: "filter", role: "driver", platform: "android" },
          title: "Aviso Conductores",
          body: "Nueva mejora en la app Android",
        },
      });

      await new Promise((r) => setImmediate(r));

      assert.strictEqual(res.status, 202);
      assert.strictEqual(res.body.totalDevices, 2);
      assert.strictEqual(res.body.uniqueUsers, 2);
      assert.strictEqual(queuedPushJobs.length, 1);
      assert.deepStrictEqual(queuedPushJobs[0].tokens, ["tok-a", "tok-b"]);
    });
  });

  describe("Envío Multi-Canal e Historial", () => {
    it("POST /send aísla canales: si Push no tiene tokens, Email sigue enviándose", async () => {
      deviceTokenService.findActiveTargetsByFilter = async () => ({
        tokens: [],
        users: [],
        totalDevices: 0,
        uniqueUsers: 0,
        byPlatform: {},
      });

      emailService.sendTemplatedEmailDirect = async (payload) => ({
        messageId: "msg-multi-1",
        accepted: [payload.to],
        rejected: [],
      });

      const res = await requestJson("/api/admin/notifications/send", {
        method: "POST",
        token: adminToken,
        body: {
          target: { type: "single", email: "solo-email@youconnext.es" },
          channels: ["push", "email"],
          push: { title: "Hola", body: "Prueba push" },
          email: { subject: "Hola", message: "Prueba email" },
          sync: true,
        },
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.channels.push.success, false);
      assert.strictEqual(res.body.channels.push.code, "NO_ACTIVE_DEVICES_FOUND");
      assert.strictEqual(res.body.channels.email.success, true);
      assert.strictEqual(res.body.channels.email.succeeded, 1);

      const histRes = await requestJson("/api/admin/notifications/history?kind=multi", {
        token: adminToken,
      });
      assert.strictEqual(histRes.status, 200);
      assert.strictEqual(histRes.body.items.length, 1);
      assert.strictEqual(histRes.body.items[0].status, "partial");
    });

    it("GET /jobs/:batchId retorna 404 si el batchId no existe", async () => {
      const res = await requestJson("/api/admin/notifications/jobs/inexistente-999", {
        token: adminToken,
      });
      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.code, "JOB_NOT_FOUND");
    });
  });
});
