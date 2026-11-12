const { v4: uuidv4 } = require("uuid");
const pkg = require("../../package.json");
const config = require("../config");
const prisma = require("../lib/prisma");
const {
  EMAIL_TEMPLATES,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
} = require("../constants");
const { isValidEmail, sanitizeString } = require("../security");
const emailService = require("./emailService");
const pushService = require("./pushService");
const templateService = require("./templateService");
const pushTemplateService = require("./pushTemplateService");
const deviceTokenService = require("./deviceTokenService");
const userDirectoryService = require("./userDirectoryService");
const notificationQueue = require("./notificationQueue");
const rabbitmqConsumer = require("./rabbitmqConsumer");
const emailChannel = require("./channels/emailChannel");
const pushChannel = require("./channels/pushChannel");
const { validateCatalogFields, getNotificationType } = require("../templates/notificationCatalog");
const { deduplicateIds } = require("../utils/templateInterpolator");

const adminDispatchHistory = [];

function createHttpError(message, status = 400, code = "BAD_REQUEST") {
  const err = new Error(message);
  err.status = status;
  err.code = code;
  return err;
}

function withTimeout(promiseFactory, timeoutMs, timeoutMessage) {
  let timer = null;
  const timeoutPromise = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const err = new Error(timeoutMessage || "Timeout de verificación");
      err.code = "CHECK_TIMEOUT";
      reject(err);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
  });

  return Promise.race([Promise.resolve().then(promiseFactory), timeoutPromise]).finally(
    () => {
      if (timer) clearTimeout(timer);
    },
  );
}

function isValidHttpUrl(rawUrl) {
  if (!rawUrl || typeof rawUrl !== "string") return false;
  try {
    const parsed = new URL(rawUrl.trim());
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

function maskToken(token) {
  if (!token || typeof token !== "string") return "";
  const trimmed = token.trim();
  if (trimmed.length <= 12) return "***";
  return `${trimmed.slice(0, 6)}...${trimmed.slice(-6)}`;
}

// ---------------------------------------------------------------------------
// Historial en memoria de operaciones de administración
// ---------------------------------------------------------------------------

function recordAdminDispatch(entry) {
  const maxEntries = config.adminNotifications?.historyMaxEntries || 100;
  const record = {
    batchId: entry.batchId || uuidv4(),
    kind: entry.kind,
    mode: entry.mode,
    status: entry.status || "queued",
    subjectOrTitle: entry.subjectOrTitle || "",
    target: entry.target || {},
    recipientSource: entry.recipientSource || null,
    recipientsCount: entry.recipientsCount || 0,
    totalDevices: entry.totalDevices ?? null,
    jobsQueued: entry.jobsQueued ?? 0,
    succeeded: entry.succeeded ?? null,
    failed: entry.failed ?? null,
    channels: entry.channels || null,
    requestedBy: entry.requestedBy || null,
    error: entry.error || null,
    createdAt: new Date().toISOString(),
  };

  adminDispatchHistory.unshift(record);
  if (adminDispatchHistory.length > maxEntries) {
    adminDispatchHistory.length = maxEntries;
  }

  return record;
}

function listAdminHistory({ limit = 25, kind } = {}) {
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const filtered = kind
    ? adminDispatchHistory.filter((item) => item.kind === String(kind).toLowerCase())
    : adminDispatchHistory;

  return {
    total: filtered.length,
    items: filtered.slice(0, safeLimit),
  };
}

function getAdminJobStatus(batchId) {
  if (!batchId) return null;
  return adminDispatchHistory.find((item) => item.batchId === String(batchId)) || null;
}

function clearAdminHistory() {
  adminDispatchHistory.length = 0;
}

// ---------------------------------------------------------------------------
// Diagnóstico y Estado completo de la API (SOLO ADMIN)
// ---------------------------------------------------------------------------

async function checkDatabaseStatus(timeoutMs) {
  const startedAt = Date.now();
  try {
    await withTimeout(
      () => prisma.$queryRaw`SELECT 1`,
      timeoutMs,
      "Timeout consultando base de datos MySQL",
    );
    return {
      ok: true,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err.message,
    };
  }
}

async function checkSmtpStatus(timeoutMs) {
  const host = process.env.SMTP_HOST || config.smtp.host;
  const port = Number(process.env.SMTP_PORT || config.smtp.port || 587);
  const user = process.env.SMTP_USER || config.smtp.user;
  const pass = process.env.SMTP_PASS || config.smtp.pass;
  const fromEmail = process.env.SMTP_FROM_EMAIL || config.smtp.fromEmail;

  const configured = Boolean(host && user && pass);
  if (!configured) {
    return {
      ok: false,
      configured: false,
      host: host || null,
      port,
      fromEmail: fromEmail || null,
      error: "Credenciales SMTP incompletas (revisa SMTP_HOST, SMTP_USER, SMTP_PASS)",
    };
  }

  const startedAt = Date.now();
  try {
    await withTimeout(
      () => emailService.verifyConnection(),
      timeoutMs,
      "Timeout verificando conexión SMTP",
    );
    return {
      ok: true,
      configured: true,
      latencyMs: Date.now() - startedAt,
      host,
      port,
      fromEmail,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      latencyMs: Date.now() - startedAt,
      host,
      port,
      fromEmail,
      error: err.message,
    };
  }
}

function checkFirebaseStatus() {
  const projectId = process.env.FIREBASE_PROJECT_ID || config.firebase.projectId;
  const clientEmail =
    process.env.FIREBASE_CLIENT_EMAIL || config.firebase.clientEmail;
  const privateKey =
    process.env.FIREBASE_PRIVATE_KEY || config.firebase.privateKey;

  const configured = Boolean(projectId && clientEmail && privateKey);
  if (!configured) {
    return {
      ok: false,
      configured: false,
      initialized: pushService.isInitialized(),
      projectId: projectId || null,
      error:
        "Credenciales Firebase incompletas (revisa FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY)",
    };
  }

  try {
    pushService.initFirebase();
    return {
      ok: true,
      configured: true,
      initialized: pushService.isInitialized(),
      projectId,
    };
  } catch (err) {
    return {
      ok: false,
      configured: true,
      initialized: pushService.isInitialized(),
      projectId,
      error: err.message,
    };
  }
}

/**
 * Construye el reporte integral del estado de la API para el panel de administración.
 */
async function getApiStatus({ checkUserService = false } = {}) {
  const timeoutMs = config.adminNotifications?.statusCheckTimeoutMs || 4000;

  const [dbOutcome, smtpOutcome, tokenStatsOutcome, userServiceHealthOutcome] =
    await Promise.allSettled([
      checkDatabaseStatus(timeoutMs),
      checkSmtpStatus(timeoutMs),
      withTimeout(
        () => deviceTokenService.getDeviceTokenStats(),
        timeoutMs,
        "Timeout calculando estadísticas de tokens",
      ),
      checkUserService
        ? userDirectoryService.checkUserServiceHealth({ timeoutMs })
        : Promise.resolve(null),
    ]);

  const database =
    dbOutcome.status === "fulfilled"
      ? dbOutcome.value
      : { ok: false, error: dbOutcome.reason?.message || "Error verificando BD" };

  const smtp =
    smtpOutcome.status === "fulfilled"
      ? smtpOutcome.value
      : { ok: false, configured: false, error: smtpOutcome.reason?.message };

  const firebase = checkFirebaseStatus();
  const queueHealth = notificationQueue.getQueueHealth();
  const consumerStatus = rabbitmqConsumer.getConsumerStatus();
  const deliveryQueueConnected = notificationQueue.isRabbitMQConnected();
  const rabbitmqConfigured = Boolean(config.rabbitmqUrl || process.env.RABBITMQ_URL);

  const userServiceBase = (
    process.env.USER_SERVICE_URL ||
    config.userService.url ||
    ""
  ).replace(/\/$/, "");

  const userService = {
    configured: Boolean(userServiceBase),
    url: userServiceBase || null,
    batchPath: config.userService.batchPath,
    listPath: config.userService.listPath,
    allowDeviceEmailFallback:
      process.env.ALLOW_DEVICE_EMAIL_FALLBACK === "true" ||
      config.userService.allowDeviceEmailFallback,
    ...(userServiceHealthOutcome.status === "fulfilled" &&
    userServiceHealthOutcome.value
      ? { health: userServiceHealthOutcome.value }
      : {}),
  };

  const deviceTokens =
    tokenStatsOutcome.status === "fulfilled"
      ? tokenStatsOutcome.value
      : {
          error: tokenStatsOutcome.reason?.message || "No disponible",
        };

  const issues = [];
  if (!database.ok) issues.push(`Base de datos no disponible: ${database.error}`);
  if (!smtp.ok) issues.push(`SMTP no operativo: ${smtp.error}`);
  if (!firebase.ok) issues.push(`Firebase FCM no operativo: ${firebase.error}`);
  if (rabbitmqConfigured && !deliveryQueueConnected) {
    issues.push("RabbitMQ (colas de entrega) desconectado; operando en cola en memoria");
  }
  if (rabbitmqConfigured && config.runWorkers && !consumerStatus.connected) {
    issues.push("Consumidor RabbitMQ de eventos de dominio desconectado");
  }
  if (userService.health && !userService.health.ok) {
    issues.push(
      `ms-usuarios no responde: ${userService.health.error || `HTTP ${userService.health.statusCode}`}`,
    );
  }

  for (const [breakerKey, breakerState] of Object.entries(
    queueHealth.circuitBreakers || {},
  )) {
    if (breakerState?.isOpen) {
      issues.push(`Circuit Breaker '${breakerKey}' en estado OPEN`);
    }
  }

  let overallStatus = "healthy";
  if (!database.ok || (!smtp.ok && !firebase.ok)) {
    overallStatus = "unhealthy";
  } else if (issues.length > 0) {
    overallStatus = "degraded";
  }

  const mem = process.memoryUsage();

  return {
    overallStatus,
    service: {
      name: pkg.name || "carpooling-notifications",
      version: pkg.version || "1.0.0",
      environment: config.nodeEnv,
      uptimeSeconds: Math.floor(process.uptime()),
      runWorkers: config.runWorkers,
      timestamp: new Date().toISOString(),
      memory: {
        rssMb: Math.round(mem.rss / 1024 / 1024),
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      },
    },
    checks: {
      database,
      smtp,
      firebase,
      rabbitmq: {
        configured: rabbitmqConfigured,
        mode: deliveryQueueConnected ? "rabbitmq" : "memory_fallback",
        deliveryQueueConnected,
        domainConsumer: consumerStatus,
      },
      userService,
    },
    queues: queueHealth,
    deviceTokens,
    adminActivity: {
      recentDispatchesCount: adminDispatchHistory.length,
      lastDispatchAt: adminDispatchHistory[0]?.createdAt || null,
    },
    issues,
  };
}

// ---------------------------------------------------------------------------
// Normalización y Resolución de Filtros de Destinatarios
// ---------------------------------------------------------------------------

function normalizeTarget(rawTarget) {
  if (!rawTarget) {
    throw createHttpError(
      "El campo 'target' es obligatorio (ej. { type: 'all' } o { type: 'single', userId: '...' }).",
      400,
      "TARGET_REQUIRED",
    );
  }

  if (typeof rawTarget === "string") {
    const normalizedStr = rawTarget.trim().toLowerCase();
    if (normalizedStr === "all" || normalizedStr === "todos") {
      return { type: "all" };
    }
    throw createHttpError(
      `Valor de 'target' no reconocido: '${rawTarget}'. Usa un objeto { type: 'all' | 'single' | 'users' | 'filter', ... }.`,
      400,
      "INVALID_TARGET",
    );
  }

  if (typeof rawTarget !== "object" || Array.isArray(rawTarget)) {
    throw createHttpError("El campo 'target' debe ser un objeto.", 400, "INVALID_TARGET");
  }

  let type = rawTarget.type ? String(rawTarget.type).trim().toLowerCase() : "";
  if (type === "todos") type = "all";

  if (!type) {
    if (rawTarget.userId || rawTarget.email || rawTarget.token) {
      type = "single";
    } else if (
      (Array.isArray(rawTarget.userIds) && rawTarget.userIds.length > 0) ||
      (Array.isArray(rawTarget.emails) && rawTarget.emails.length > 0) ||
      (Array.isArray(rawTarget.tokens) && rawTarget.tokens.length > 0)
    ) {
      type = "users";
    } else if (rawTarget.role || rawTarget.platform) {
      type = "filter";
    }
  }

  const allowedTypes = ["all", "single", "users", "filter"];
  if (!allowedTypes.includes(type)) {
    throw createHttpError(
      `Tipo de filtro 'target.type' no válido ('${type}'). Soportados: all, single, users, filter.`,
      400,
      "INVALID_TARGET_TYPE",
    );
  }

  return {
    type,
    userId: rawTarget.userId ? String(rawTarget.userId).trim() : undefined,
    email: rawTarget.email ? String(rawTarget.email).trim() : undefined,
    name: rawTarget.name ? sanitizeString(rawTarget.name, 120) : undefined,
    token: rawTarget.token ? String(rawTarget.token).trim() : undefined,
    userIds: deduplicateIds(rawTarget.userIds),
    emails: Array.isArray(rawTarget.emails)
      ? rawTarget.emails.map((e) => String(e).trim()).filter(Boolean)
      : [],
    tokens: deduplicateIds(rawTarget.tokens),
    role: rawTarget.role ? String(rawTarget.role).trim() : undefined,
    platform: rawTarget.platform
      ? String(rawTarget.platform).trim().toLowerCase()
      : undefined,
    fallbackToDeviceTokens: rawTarget.fallbackToDeviceTokens,
  };
}

function dedupeEmailRecipients(records) {
  const byEmail = new Map();
  for (const item of records) {
    if (!item || !isValidEmail(item.email)) continue;
    const key = item.email.trim().toLowerCase();
    if (!byEmail.has(key)) {
      byEmail.set(key, {
        userId: item.userId ? String(item.userId) : "",
        email: item.email.trim(),
        name: item.name || "",
      });
    }
  }
  return Array.from(byEmail.values());
}

async function resolveUsersWithOptionalDeviceFallback(userIds, allowDeviceFallback) {
  const hasUserService = Boolean(
    process.env.USER_SERVICE_URL || config.userService.url,
  );

  if (hasUserService) {
    try {
      const users = await userDirectoryService.resolveUsersByIds(userIds);
      return { users, source: "user_service" };
    } catch (err) {
      if (!allowDeviceFallback) throw err;
      const fallback = await deviceTokenService.getKnownEmailsByUserIds(userIds);
      return { users: fallback, source: "device_tokens_fallback" };
    }
  }

  const fallback = await deviceTokenService.getKnownEmailsByUserIds(userIds);
  return { users: fallback, source: "device_tokens_fallback" };
}

/**
 * Resuelve destinatarios de correo electrónico según los filtros del administrador.
 */
async function resolveEmailTargets(rawTarget) {
  const target = normalizeTarget(rawTarget);
  const allowDeviceFallback =
    target.fallbackToDeviceTokens === true ||
    config.userService.allowDeviceEmailFallback ||
    (!process.env.USER_SERVICE_URL &&
      !config.userService.url &&
      target.fallbackToDeviceTokens !== false);

  if (target.type === "single") {
    if (target.email) {
      if (!isValidEmail(target.email)) {
        throw createHttpError(
          `El email destinatario '${target.email}' no es válido.`,
          400,
          "INVALID_EMAIL",
        );
      }
      return {
        target,
        recipients: [
          {
            userId: target.userId || "",
            email: target.email,
            name: target.name || "",
          },
        ],
        recipientSource: "explicit",
      };
    }

    if (!target.userId) {
      throw createHttpError(
        "Para target.type='single' en email se requiere 'userId' o 'email'.",
        400,
        "SINGLE_TARGET_REQUIRED",
      );
    }

    const { users, source } = await resolveUsersWithOptionalDeviceFallback(
      [target.userId],
      allowDeviceFallback,
    );
    return {
      target,
      recipients: dedupeEmailRecipients(users),
      recipientSource: source,
    };
  }

  if (target.type === "users") {
    if (target.emails.length === 0 && target.userIds.length === 0) {
      throw createHttpError(
        "Para target.type='users' en email se requiere 'userIds' o 'emails'.",
        400,
        "USERS_TARGET_REQUIRED",
      );
    }

    const collected = [];
    const sources = new Set();

    for (const email of target.emails) {
      if (!isValidEmail(email)) {
        throw createHttpError(
          `Email inválido en target.emails: '${email}'.`,
          400,
          "INVALID_EMAIL",
        );
      }
      collected.push({ userId: "", email, name: "" });
      sources.add("explicit");
    }

    if (target.userIds.length > 0) {
      const { users, source } = await resolveUsersWithOptionalDeviceFallback(
        target.userIds,
        allowDeviceFallback,
      );
      collected.push(...users);
      sources.add(source);
    }

    return {
      target,
      recipients: dedupeEmailRecipients(collected),
      recipientSource: Array.from(sources).join("+") || "explicit",
    };
  }

  // target.type === "all" || "filter"
  if (target.platform && target.platform !== "all") {
    const deviceRes = await deviceTokenService.findActiveTargetsByFilter({
      role: target.role,
      platform: target.platform,
    });
    return {
      target,
      recipients: dedupeEmailRecipients(deviceRes.users),
      recipientSource: "device_tokens_filter",
    };
  }

  const hasUserService = Boolean(
    process.env.USER_SERVICE_URL || config.userService.url,
  );

  if (hasUserService) {
    try {
      const users = await userDirectoryService.listUsersByFilter({
        role: target.role,
        fetchAll: true,
        maxResults: config.batch.maxRecipients || 5000,
      });
      return {
        target,
        recipients: dedupeEmailRecipients(users),
        recipientSource: "user_service",
      };
    } catch (err) {
      const canFallback =
        target.fallbackToDeviceTokens === true ||
        (allowDeviceFallback &&
          (err.status === 404 || err.code === "USER_SERVICE_NOT_CONFIGURED"));

      if (!canFallback) {
        throw createHttpError(
          `No se pudo listar usuarios desde ms-usuarios: ${err.message}`,
          502,
          "USER_SERVICE_ERROR",
        );
      }
    }
  } else if (!allowDeviceFallback) {
    throw createHttpError(
      "USER_SERVICE_URL no configurada para resolver todos los emails. Configura USER_SERVICE_URL o habilita fallbackToDeviceTokens.",
      400,
      "USER_SERVICE_NOT_CONFIGURED",
    );
  }

  const deviceRes = await deviceTokenService.findActiveTargetsByFilter({
    role: target.role,
  });
  return {
    target,
    recipients: dedupeEmailRecipients(deviceRes.users),
    recipientSource: "device_tokens_fallback",
  };
}

/**
 * Resuelve tokens FCM activos según los filtros del administrador.
 */
async function resolvePushTargets(rawTarget) {
  const target = normalizeTarget(rawTarget);

  if (target.type === "single") {
    if (target.token) {
      return {
        target,
        tokens: [target.token],
        uniqueUsers: target.userId ? 1 : 0,
        totalDevices: 1,
        byPlatform: {},
        recipientSource: "explicit_token",
      };
    }

    if (!target.userId && !target.email) {
      throw createHttpError(
        "Para target.type='single' en push se requiere 'userId', 'email' o 'token'.",
        400,
        "SINGLE_TARGET_REQUIRED",
      );
    }

    const res = await deviceTokenService.findActiveTargetsByFilter({
      userId: target.userId,
      email: target.email,
    });
    return {
      target,
      ...res,
      recipientSource: "device_tokens",
    };
  }

  if (target.type === "users") {
    if (
      target.tokens.length === 0 &&
      target.userIds.length === 0 &&
      target.emails.length === 0
    ) {
      throw createHttpError(
        "Para target.type='users' en push se requiere 'userIds', 'emails' o 'tokens'.",
        400,
        "USERS_TARGET_REQUIRED",
      );
    }

    let dbRes = { tokens: [], uniqueUsers: 0, byPlatform: {} };
    if (target.userIds.length > 0 || target.emails.length > 0) {
      dbRes = await deviceTokenService.findActiveTargetsByFilter({
        userIds: target.userIds,
        emails: target.emails,
      });
    }

    const mergedTokens = deduplicateIds([...target.tokens, ...dbRes.tokens]);
    return {
      target,
      tokens: mergedTokens,
      totalDevices: mergedTokens.length,
      uniqueUsers: dbRes.uniqueUsers,
      byPlatform: dbRes.byPlatform,
      recipientSource:
        target.tokens.length > 0 && dbRes.tokens.length === 0
          ? "explicit_tokens"
          : "device_tokens",
    };
  }

  // target.type === "all" || "filter"
  const res = await deviceTokenService.findActiveTargetsByFilter({
    role: target.role,
    platform: target.platform,
  });

  return {
    target,
    ...res,
    recipientSource: "device_tokens",
  };
}

/**
 * Previsualiza el alcance de un envío administrativo sin ejecutar envíos reales.
 */
async function previewRecipients({ target, channels = ["push", "email"] } = {}) {
  const normalizedChannels = deduplicateIds(
    (Array.isArray(channels) ? channels : [channels]).map((c) =>
      String(c).toLowerCase(),
    ),
  );

  const result = {
    target: normalizeTarget(target),
    preview: {},
  };

  if (normalizedChannels.includes(NOTIFICATION_CHANNELS.PUSH)) {
    try {
      const pushRes = await resolvePushTargets(target);
      result.preview.push = {
        available: pushRes.totalDevices > 0,
        totalDevices: pushRes.totalDevices,
        uniqueUsers: pushRes.uniqueUsers,
        byPlatform: pushRes.byPlatform,
        recipientSource: pushRes.recipientSource,
      };
    } catch (err) {
      result.preview.push = {
        available: false,
        totalDevices: 0,
        error: err.message,
      };
    }
  }

  if (normalizedChannels.includes(NOTIFICATION_CHANNELS.EMAIL)) {
    try {
      const emailRes = await resolveEmailTargets(target);
      result.preview.email = {
        available: emailRes.recipients.length > 0,
        totalRecipients: emailRes.recipients.length,
        recipientSource: emailRes.recipientSource,
        sampleRecipients: emailRes.recipients
          .slice(0, 5)
          .map((r) => ({ userId: r.userId, email: r.email })),
      };
    } catch (err) {
      result.preview.email = {
        available: false,
        totalRecipients: 0,
        error: err.message,
      };
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// Envío Personalizado de Emails (SOLO ADMIN)
// ---------------------------------------------------------------------------

function buildEmailContentConfig(input) {
  const { template, data = {}, subject, title, message, html, text, ctaText, ctaUrl } =
    input;

  if (template && template !== EMAIL_TEMPLATES.ADMIN_CUSTOM) {
    if (!templateService.hasTemplate(template)) {
      const available = Object.keys(templateService.TEMPLATES).join(", ");
      throw createHttpError(
        `Template '${template}' no válido. Disponibles: ${available}`,
        400,
        "INVALID_TEMPLATE",
      );
    }

    const catalogDef = getNotificationType(template);
    const mergedData = {
      ...(catalogDef?.defaults || {}),
      ...(data || {}),
      frontendUrl: data?.frontendUrl || config.frontendUrl || "",
    };

    const missing = validateCatalogFields(template, mergedData);
    if (missing.length > 0) {
      throw createHttpError(
        `Faltan campos obligatorios para el template '${template}': ${missing.join(", ")}`,
        400,
        "MISSING_TEMPLATE_FIELDS",
      );
    }

    return {
      mode: "template",
      template,
      data: mergedData,
      subjectOrTitle: template,
    };
  }

  if (!subject || !String(subject).trim()) {
    throw createHttpError(
      "El campo 'subject' es obligatorio para correos personalizados.",
      400,
      "SUBJECT_REQUIRED",
    );
  }

  const cleanSubject = sanitizeString(subject, 300);

  if (message && String(message).trim()) {
    if (ctaUrl && !isValidHttpUrl(ctaUrl)) {
      throw createHttpError(
        "El campo 'ctaUrl' debe ser una URL válida (http:// o https://).",
        400,
        "INVALID_CTA_URL",
      );
    }

    const cleanTitle = title ? sanitizeString(title, 200) : cleanSubject;
    const cleanMessage = String(message).trim().slice(0, 8000);

    return {
      mode: "admin_custom",
      template: EMAIL_TEMPLATES.ADMIN_CUSTOM,
      data: {
        ...(data || {}),
        subject: cleanSubject,
        title: cleanTitle,
        message: cleanMessage,
        ctaText: ctaText ? sanitizeString(ctaText, 80) : "",
        ctaUrl: ctaUrl ? String(ctaUrl).trim() : "",
        frontendUrl: config.frontendUrl || "",
      },
      subjectOrTitle: cleanSubject,
    };
  }

  if (!html && !text) {
    throw createHttpError(
      "Se requiere 'message' (para plantilla corporativa), 'html'/'text', o un 'template' válido.",
      400,
      "EMAIL_BODY_REQUIRED",
    );
  }

  return {
    mode: "raw",
    subject: cleanSubject,
    html: html || undefined,
    text: text || undefined,
    subjectOrTitle: cleanSubject,
  };
}

async function sendAdminEmail(input = {}) {
  const {
    target,
    sync = false,
    dryRun = false,
    priority = NOTIFICATION_PRIORITIES.HIGH,
    requestedBy = null,
    skipHistoryRecord = false,
  } = input;

  const contentConfig = buildEmailContentConfig(input);
  const { target: normalizedTarget, recipients, recipientSource } =
    await resolveEmailTargets(target);

  if (recipients.length === 0) {
    throw createHttpError(
      "No se encontraron destinatarios de correo electrónico para los filtros indicados.",
      404,
      "NO_RECIPIENTS_FOUND",
    );
  }

  const maxRecipients = config.batch.maxRecipients || 5000;
  if (recipients.length > maxRecipients) {
    throw createHttpError(
      `El lote excede el máximo permitido (${maxRecipients} destinatarios).`,
      400,
      "BATCH_LIMIT_EXCEEDED",
    );
  }

  if (dryRun === true) {
    return {
      success: true,
      dryRun: true,
      channel: NOTIFICATION_CHANNELS.EMAIL,
      target: normalizedTarget,
      recipientSource,
      recipientsCount: recipients.length,
      sampleRecipients: recipients.slice(0, 10),
    };
  }

  const batchId = uuidv4();

  const buildPayloadForRecipient = (recipient) => {
    if (contentConfig.mode === "raw") {
      return {
        batchId,
        userId: recipient.userId || undefined,
        to: recipient.email,
        subject: contentConfig.subject,
        html: contentConfig.html,
        text: contentConfig.text,
        priority,
      };
    }

    return {
      batchId,
      userId: recipient.userId || undefined,
      to: recipient.email,
      template: contentConfig.template,
      data: {
        ...contentConfig.data,
        userName: recipient.name || contentConfig.data.userName || "",
      },
      priority,
    };
  };

  if (sync === true) {
    const maxSync = config.adminNotifications?.maxSyncRecipients || 50;
    if (recipients.length > maxSync) {
      throw createHttpError(
        `El envío síncrono está limitado a ${maxSync} destinatarios para evitar timeouts (encontrados: ${recipients.length}). Usa modo asíncrono (sync: false).`,
        400,
        "SYNC_LIMIT_EXCEEDED",
      );
    }

    const results = [];
    const CONCURRENCY = 5;
    for (let i = 0; i < recipients.length; i += CONCURRENCY) {
      const slice = recipients.slice(i, i + CONCURRENCY);
      const sliceResults = await Promise.all(
        slice.map(async (recipient) => {
          const payload = buildPayloadForRecipient(recipient);
          try {
            const sendRes =
              contentConfig.mode === "raw"
                ? await emailService.sendEmailDirect(payload)
                : await emailService.sendTemplatedEmailDirect(payload);
            return {
              to: recipient.email,
              userId: recipient.userId || undefined,
              success: true,
              ...sendRes,
            };
          } catch (err) {
            return {
              to: recipient.email,
              userId: recipient.userId || undefined,
              success: false,
              error: err.message,
            };
          }
        }),
      );
      results.push(...sliceResults);
    }

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.length - succeeded;
    const status =
      failed === 0 ? "completed" : succeeded > 0 ? "partial" : "failed";

    if (!skipHistoryRecord) {
      recordAdminDispatch({
        batchId,
        kind: NOTIFICATION_CHANNELS.EMAIL,
        mode: "sync",
        status,
        subjectOrTitle: contentConfig.subjectOrTitle,
        target: normalizedTarget,
        recipientSource,
        recipientsCount: recipients.length,
        succeeded,
        failed,
        requestedBy,
      });
    }

    return {
      success: succeeded > 0,
      mode: "sync",
      status,
      batchId,
      channel: NOTIFICATION_CHANNELS.EMAIL,
      recipientSource,
      total: results.length,
      succeeded,
      failed,
      results,
    };
  }

  const payloads = recipients.map(buildPayloadForRecipient);
  const queuedJobs = await emailChannel.enqueueSingleEmailJobs(payloads);
  const queueType = queuedJobs[0]?.queueType || "rabbitmq";

  if (!skipHistoryRecord) {
    recordAdminDispatch({
      batchId,
      kind: NOTIFICATION_CHANNELS.EMAIL,
      mode: "async",
      status: "queued",
      subjectOrTitle: contentConfig.subjectOrTitle,
      target: normalizedTarget,
      recipientSource,
      recipientsCount: recipients.length,
      jobsQueued: queuedJobs.length,
      requestedBy,
    });
  }

  return {
    success: true,
    mode: "async",
    status: "queued",
    message: "Correos personalizados de administrador encolados satisfactoriamente.",
    batchId,
    channel: NOTIFICATION_CHANNELS.EMAIL,
    recipientSource,
    recipientsCount: recipients.length,
    jobsQueued: queuedJobs.length,
    queueType,
  };
}

// ---------------------------------------------------------------------------
// Envío Personalizado de Notificaciones Push (SOLO ADMIN)
// ---------------------------------------------------------------------------

function buildPushContentConfig(input) {
  const { template, data = {}, title, body, priority, channelId, badge } = input;

  if (template) {
    try {
      const rendered = pushTemplateService.renderPushTemplate(template, data);
      return {
        title: rendered.title,
        body: rendered.body,
        data: { ...rendered.data, ...(data || {}), source: "admin_panel" },
        priority: priority || NOTIFICATION_PRIORITIES.HIGH,
        channelId: channelId || "default",
        badge,
      };
    } catch (err) {
      throw createHttpError(err.message, 400, "INVALID_PUSH_TEMPLATE");
    }
  }

  if (!title || !String(title).trim()) {
    throw createHttpError(
      "El campo 'title' es obligatorio para notificaciones push personalizadas.",
      400,
      "TITLE_REQUIRED",
    );
  }
  if (!body || !String(body).trim()) {
    throw createHttpError(
      "El campo 'body' es obligatorio para notificaciones push personalizadas.",
      400,
      "BODY_REQUIRED",
    );
  }

  return {
    title: sanitizeString(title, 200),
    body: sanitizeString(body, 1000),
    data: {
      type: "admin_custom",
      source: "admin_panel",
      ...(data && typeof data === "object" ? data : {}),
    },
    priority: priority || NOTIFICATION_PRIORITIES.HIGH,
    channelId: channelId || "default",
    badge,
  };
}

async function sendAdminPush(input = {}) {
  const {
    target,
    sync = false,
    dryRun = false,
    requestedBy = null,
    skipHistoryRecord = false,
  } = input;

  const pushContent = buildPushContentConfig(input);
  const resolved = await resolvePushTargets(target);

  if (resolved.tokens.length === 0) {
    throw createHttpError(
      "No se encontraron dispositivos activos registrados para los filtros indicados.",
      404,
      "NO_ACTIVE_DEVICES_FOUND",
    );
  }

  const maxRecipients = config.batch.maxRecipients || 5000;
  if (resolved.tokens.length > maxRecipients) {
    throw createHttpError(
      `El lote excede el máximo permitido (${maxRecipients} dispositivos).`,
      400,
      "BATCH_LIMIT_EXCEEDED",
    );
  }

  if (dryRun === true) {
    return {
      success: true,
      dryRun: true,
      channel: NOTIFICATION_CHANNELS.PUSH,
      target: resolved.target,
      recipientSource: resolved.recipientSource,
      totalDevices: resolved.totalDevices,
      uniqueUsers: resolved.uniqueUsers,
      byPlatform: resolved.byPlatform,
    };
  }

  const batchId = uuidv4();

  if (sync === true) {
    const maxSync = config.adminNotifications?.maxSyncRecipients || 50;
    if (resolved.tokens.length > maxSync) {
      throw createHttpError(
        `El envío push síncrono está limitado a ${maxSync} dispositivos (encontrados: ${resolved.tokens.length}). Usa modo asíncrono (sync: false).`,
        400,
        "SYNC_LIMIT_EXCEEDED",
      );
    }

    const rawResults = await pushService.sendToTokensDirect(resolved.tokens, {
      ...pushContent,
      data: { ...pushContent.data, batchId },
    });

    const succeeded = rawResults.filter((r) => r.success).length;
    const failed = rawResults.length - succeeded;
    const status =
      failed === 0 ? "completed" : succeeded > 0 ? "partial" : "failed";

    if (!skipHistoryRecord) {
      recordAdminDispatch({
        batchId,
        kind: NOTIFICATION_CHANNELS.PUSH,
        mode: "sync",
        status,
        subjectOrTitle: pushContent.title,
        target: resolved.target,
        recipientSource: resolved.recipientSource,
        recipientsCount: resolved.uniqueUsers || resolved.tokens.length,
        totalDevices: resolved.tokens.length,
        succeeded,
        failed,
        requestedBy,
      });
    }

    return {
      success: succeeded > 0,
      mode: "sync",
      status,
      batchId,
      channel: NOTIFICATION_CHANNELS.PUSH,
      recipientSource: resolved.recipientSource,
      total: rawResults.length,
      succeeded,
      failed,
      results: rawResults.map((r) => ({
        tokenPreview: maskToken(r.token),
        success: r.success,
        messageId: r.messageId,
        errorCode: r.errorCode,
        error: r.error,
      })),
    };
  }

  const queueResult = await pushChannel.enqueueBatch({
    batchId,
    title: pushContent.title,
    body: pushContent.body,
    data: pushContent.data,
    priority: pushContent.priority,
    channelId: pushContent.channelId,
    badge: pushContent.badge,
    tokens: resolved.tokens,
  });

  if (!skipHistoryRecord) {
    recordAdminDispatch({
      batchId,
      kind: NOTIFICATION_CHANNELS.PUSH,
      mode: "async",
      status: "queued",
      subjectOrTitle: pushContent.title,
      target: resolved.target,
      recipientSource: resolved.recipientSource,
      recipientsCount: resolved.uniqueUsers || resolved.tokens.length,
      totalDevices: resolved.tokens.length,
      jobsQueued: queueResult.jobsQueued,
      requestedBy,
    });
  }

  return {
    success: true,
    mode: "async",
    status: "queued",
    message: "Notificaciones push de administrador encoladas satisfactoriamente.",
    batchId,
    channel: NOTIFICATION_CHANNELS.PUSH,
    recipientSource: resolved.recipientSource,
    totalDevices: resolved.totalDevices,
    uniqueUsers: resolved.uniqueUsers,
    byPlatform: resolved.byPlatform,
    ...queueResult,
  };
}

// ---------------------------------------------------------------------------
// Envío Unificado Multi-Canal (SOLO ADMIN)
// ---------------------------------------------------------------------------

async function sendAdminMultiChannel(input = {}) {
  const {
    target,
    channels,
    email,
    push,
    sync = false,
    dryRun = false,
    requestedBy = null,
  } = input;

  const requestedChannels = Array.isArray(channels) && channels.length > 0
    ? deduplicateIds(channels.map((c) => String(c).toLowerCase()))
    : [
        ...(push ? [NOTIFICATION_CHANNELS.PUSH] : []),
        ...(email ? [NOTIFICATION_CHANNELS.EMAIL] : []),
      ];

  const validChannels = requestedChannels.filter(
    (c) => c === NOTIFICATION_CHANNELS.PUSH || c === NOTIFICATION_CHANNELS.EMAIL,
  );

  if (validChannels.length === 0) {
    throw createHttpError(
      "Se requiere al menos un canal válido en 'channels' ('push', 'email') o los bloques 'push'/'email'.",
      400,
      "CHANNELS_REQUIRED",
    );
  }

  const tasks = [];
  if (validChannels.includes(NOTIFICATION_CHANNELS.PUSH)) {
    if (!push || typeof push !== "object") {
      throw createHttpError(
        "Falta el objeto 'push' con 'title' y 'body' (o 'template').",
        400,
        "PUSH_CONFIG_REQUIRED",
      );
    }
    tasks.push({
      channel: NOTIFICATION_CHANNELS.PUSH,
      promise: sendAdminPush({
        ...push,
        target,
        sync,
        dryRun,
        requestedBy,
        skipHistoryRecord: true,
      }),
    });
  }

  if (validChannels.includes(NOTIFICATION_CHANNELS.EMAIL)) {
    if (!email || typeof email !== "object") {
      throw createHttpError(
        "Falta el objeto 'email' con 'subject' y 'message'/'html' (o 'template').",
        400,
        "EMAIL_CONFIG_REQUIRED",
      );
    }
    tasks.push({
      channel: NOTIFICATION_CHANNELS.EMAIL,
      promise: sendAdminEmail({
        ...email,
        target,
        sync,
        dryRun,
        requestedBy,
        skipHistoryRecord: true,
      }),
    });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.promise));
  const channelResults = {};
  let succeededCount = 0;

  settled.forEach((outcome, idx) => {
    const ch = tasks[idx].channel;
    if (outcome.status === "fulfilled") {
      channelResults[ch] = outcome.value;
      succeededCount += 1;
    } else {
      channelResults[ch] = {
        success: false,
        status: "failed",
        code: outcome.reason?.code || "CHANNEL_ERROR",
        error: outcome.reason?.message || "Error procesando canal",
      };
    }
  });

  if (succeededCount === 0) {
    const firstErr = settled.find((s) => s.status === "rejected")?.reason;
    throw firstErr || createHttpError("Fallaron todos los canales solicitados.", 400);
  }

  const batchId = uuidv4();
  const mode = dryRun ? "dry_run" : sync ? "sync" : "async";
  if (!dryRun) {
    recordAdminDispatch({
      batchId,
      kind: "multi",
      mode,
      status: succeededCount === tasks.length ? (sync ? "completed" : "queued") : "partial",
      subjectOrTitle: push?.title || email?.subject || "Multi-canal",
      target: normalizeTarget(target),
      channels: channelResults,
      requestedBy,
    });
  }

  return {
    success: true,
    mode,
    dryRun,
    batchId,
    channels: channelResults,
  };
}

module.exports = {
  getApiStatus,
  listAdminHistory,
  getAdminJobStatus,
  clearAdminHistory,
  previewRecipients,
  sendAdminEmail,
  sendAdminPush,
  sendAdminMultiChannel,
  normalizeTarget,
  resolveEmailTargets,
  resolvePushTargets,
};
