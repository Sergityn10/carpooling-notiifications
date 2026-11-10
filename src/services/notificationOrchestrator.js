const { v4: uuidv4 } = require("uuid");
const config = require("../config");
const {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
} = require("../constants");
const { sanitizeString } = require("../security");
const {
  getNotificationType,
  validateCatalogFields,
} = require("../templates/notificationCatalog");
const pushTemplateService = require("./pushTemplateService");
const pushChannel = require("./channels/pushChannel");
const emailChannel = require("./channels/emailChannel");
const { deduplicateIds } = require("../utils/templateInterpolator");

// Caché en memoria acotada para idempotencia sin depender de Redis en VPS
const idempotencyCache = new Map();

function createValidationError(message, code = "VALIDATION_ERROR", status = 400) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.isPermanent = true;
  return err;
}

function getCachedIdempotencyResult(key) {
  if (!key) return null;
  const entry = idempotencyCache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    idempotencyCache.delete(key);
    return null;
  }
  return entry.result;
}

function saveIdempotencyResult(key, result) {
  if (!key) return;
  const ttlMs = config.batch.idempotencyTtlMs || 15 * 60 * 1000;
  const maxEntries = config.batch.idempotencyMaxEntries || 10000;

  if (idempotencyCache.size >= maxEntries) {
    const oldestKey = idempotencyCache.keys().next().value;
    if (oldestKey !== undefined) {
      idempotencyCache.delete(oldestKey);
    }
  }

  idempotencyCache.set(key, {
    expiresAt: Date.now() + ttlMs,
    result,
  });
}

function clearIdempotencyCache() {
  idempotencyCache.clear();
}

/**
 * Orquesta envíos masivos multi-canal desacoplados a partir de un tipo de catálogo,
 * datos compartidos del evento (sharedData) y una lista de userIds (o recipients).
 */
async function dispatchBatch(input = {}) {
  const {
    idempotencyKey,
    type,
    channels,
    priority = NOTIFICATION_PRIORITIES.HIGH,
    sharedData = {},
    userIds = [],
    recipients = [],
    pushOverrides = {},
  } = input;

  if (!type || typeof type !== "string") {
    throw createValidationError("El campo 'type' es obligatorio.");
  }

  const catalogEntry = getNotificationType(type);
  if (!catalogEntry) {
    throw createValidationError(
      `Tipo de notificación '${type}' no reconocido en el catálogo.`,
      "UNKNOWN_NOTIFICATION_TYPE",
    );
  }

  if (idempotencyKey) {
    const cached = getCachedIdempotencyResult(String(idempotencyKey));
    if (cached) {
      return { ...cached, deduplicated: true };
    }
  }

  const mergedData = {
    ...catalogEntry.defaults,
    ...(sharedData || {}),
    frontendUrl: sharedData?.frontendUrl || config.frontendUrl || "",
  };

  const normalizedRecipients = Array.isArray(recipients) ? recipients : [];
  const allUserIds = deduplicateIds([
    ...(Array.isArray(userIds) ? userIds : []),
    ...normalizedRecipients.map((r) => r?.userId).filter(Boolean),
  ]);

  const missingFields = validateCatalogFields(type, mergedData, {
    sharedOnly: allUserIds.length > 0,
  });
  if (missingFields.length > 0) {
    throw createValidationError(
      `Faltan campos obligatorios en 'sharedData' para '${type}': ${missingFields.join(", ")}`,
    );
  }

  const totalRecipients = Math.max(allUserIds.length, normalizedRecipients.length);
  if (totalRecipients === 0) {
    throw createValidationError(
      "Se requiere al menos un destinatario en 'userIds' o 'recipients'.",
    );
  }

  const maxRecipients = config.batch.maxRecipients || 5000;
  if (totalRecipients > maxRecipients) {
    throw createValidationError(
      `El lote excede el máximo permitido por petición (${maxRecipients} destinatarios).`,
      "BATCH_LIMIT_EXCEEDED",
    );
  }

  const requestedChannels =
    Array.isArray(channels) && channels.length > 0
      ? deduplicateIds(channels.map((c) => String(c).toLowerCase()))
      : [...catalogEntry.channels];

  const activeChannels = requestedChannels.filter((ch) =>
    catalogEntry.channels.includes(ch),
  );

  if (activeChannels.length === 0) {
    throw createValidationError(
      `Ninguno de los canales solicitados (${requestedChannels.join(", ")}) está soportado para '${type}'. Soportados: ${catalogEntry.channels.join(", ")}`,
    );
  }

  const batchId = uuidv4();
  const channelPromises = {};

  if (
    activeChannels.includes(NOTIFICATION_CHANNELS.PUSH) &&
    catalogEntry.pushTemplate
  ) {
    const renderedPush = pushTemplateService.renderPushTemplate(
      catalogEntry.pushTemplate,
      mergedData,
    );

    const pushTitle = pushOverrides?.title
      ? sanitizeString(pushOverrides.title, 200)
      : renderedPush.title;
    const pushBody = pushOverrides?.body
      ? sanitizeString(pushOverrides.body, 1000)
      : renderedPush.body;

    channelPromises.push = pushChannel.enqueueBatch({
      batchId,
      title: pushTitle,
      body: pushBody,
      data: renderedPush.data,
      priority,
      userIds: allUserIds,
    });
  }

  if (
    activeChannels.includes(NOTIFICATION_CHANNELS.EMAIL) &&
    catalogEntry.emailTemplate
  ) {
    channelPromises.email = emailChannel.enqueueBatch({
      batchId,
      type,
      template: catalogEntry.emailTemplate,
      sharedData: mergedData,
      userIds: Array.isArray(userIds) ? userIds : [],
      recipients: normalizedRecipients,
      priority,
    });
  }

  const entries = Object.entries(channelPromises);
  const settled = await Promise.allSettled(entries.map(([, p]) => p));

  const channelResults = {};
  let succeededChannels = 0;

  settled.forEach((outcome, index) => {
    const [channelName] = entries[index];
    if (outcome.status === "fulfilled") {
      channelResults[channelName] = outcome.value;
      succeededChannels += 1;
    } else {
      channelResults[channelName] = {
        channel: channelName,
        status: "failed",
        error: outcome.reason?.message || "Error al encolar canal",
      };
    }
  });

  if (succeededChannels === 0) {
    const firstRejected = settled.find((s) => s.status === "rejected");
    throw firstRejected?.reason || new Error("Fallaron todos los canales del lote.");
  }

  const result = {
    batchId,
    type,
    status: "queued",
    deduplicated: false,
    totalRecipients,
    channels: channelResults,
    queuedAt: new Date().toISOString(),
  };

  if (idempotencyKey) {
    saveIdempotencyResult(String(idempotencyKey), result);
  }

  return result;
}

module.exports = {
  dispatchBatch,
  clearIdempotencyCache,
};
