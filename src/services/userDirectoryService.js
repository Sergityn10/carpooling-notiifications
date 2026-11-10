const config = require("../config");
const CircuitBreaker = require("../security/circuitBreaker");
const { isValidEmail } = require("../security");
const deviceTokenService = require("./deviceTokenService");
const { chunkArray, deduplicateIds } = require("../utils/templateInterpolator");

const usersCircuitBreaker = new CircuitBreaker("UsersService", {
  failureThreshold: 5,
  recoveryTimeoutMs: 25000,
  callTimeoutMs: (config.userService.timeoutMs || 5000) + 1000,
});

function buildBatchUsersUrl() {
  const base = (
    process.env.USER_SERVICE_URL ||
    config.userService.url ||
    ""
  ).replace(/\/$/, "");
  const path =
    process.env.USER_SERVICE_BATCH_PATH ||
    config.userService.batchPath ||
    "/api/users/internal/batch";

  if (!base) return "";
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function normalizeUserRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const userId = raw.userId || raw.id || raw.sub;
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  if (!isValidEmail(email)) return null;

  return {
    userId: userId ? String(userId) : "",
    email,
    name: raw.name || raw.fullName || raw.firstName || "",
  };
}

/**
 * Resuelve emails de usuarios en lote consultando a ms-usuarios por HTTP interno.
 * Protegido por Circuit Breaker, timeout estricto y fragmentación en chunks.
 */
async function resolveUsersByIds(userIds, options = {}) {
  const uniqueIds = deduplicateIds(userIds);
  if (uniqueIds.length === 0) return [];

  const targetUrl = buildBatchUsersUrl();
  const allowFallback =
    process.env.ALLOW_DEVICE_EMAIL_FALLBACK === "true" ||
    config.userService.allowDeviceEmailFallback;

  if (!targetUrl) {
    if (allowFallback) {
      console.warn(
        "[UserDirectoryService] USER_SERVICE_URL no configurada. Usando fallback de emails en UserDeviceToken (solo desarrollo).",
      );
      const fallbackUsers =
        await deviceTokenService.getKnownEmailsByUserIds(uniqueIds);
      return fallbackUsers.filter((u) => isValidEmail(u.email));
    }

    const err = new Error(
      "USER_SERVICE_URL no configurada para resolver emails de destinatarios en lote.",
    );
    err.code = "USER_SERVICE_NOT_CONFIGURED";
    err.isPermanent = true;
    throw err;
  }

  const fetchImpl = options.fetcher || global.fetch;
  const timeoutMs = config.userService.timeoutMs || 5000;
  const serviceKey =
    process.env.INTERNAL_SERVICE_API_KEY ||
    process.env.SERVICE_API_KEY ||
    config.serviceApiKey;

  const resolvedMap = new Map();
  const chunkSize = config.batch.idLookupChunkSize || 500;

  for (const chunk of chunkArray(uniqueIds, chunkSize)) {
    const usersChunk = await usersCircuitBreaker.execute(async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      if (typeof timer.unref === "function") timer.unref();

      try {
        const headers = {
          "Content-Type": "application/json",
        };
        if (serviceKey) {
          headers["X-Service-Api-Key"] = serviceKey;
        }

        const response = await fetchImpl(targetUrl, {
          method: "POST",
          headers,
          body: JSON.stringify({ userIds: chunk }),
          signal: controller.signal,
        });

        if (!response.ok) {
          const err = new Error(
            `ms-usuarios respondió con HTTP ${response.status} al resolver lote de usuarios`,
          );
          err.status = response.status;
          err.isPermanent = response.status >= 400 && response.status < 500 && response.status !== 429;
          throw err;
        }

        const data = await response.json();
        const list = Array.isArray(data)
          ? data
          : Array.isArray(data?.users)
            ? data.users
            : Array.isArray(data?.data)
              ? data.data
              : [];

        return list;
      } finally {
        clearTimeout(timer);
      }
    });

    for (const rawUser of usersChunk) {
      const normalized = normalizeUserRecord(rawUser);
      if (!normalized) continue;
      const dedupeKey = normalized.userId || normalized.email.toLowerCase();
      if (!resolvedMap.has(dedupeKey)) {
        resolvedMap.set(dedupeKey, normalized);
      }
    }
  }

  return Array.from(resolvedMap.values());
}

module.exports = {
  resolveUsersByIds,
  usersCircuitBreaker,
  buildBatchUsersUrl,
};
