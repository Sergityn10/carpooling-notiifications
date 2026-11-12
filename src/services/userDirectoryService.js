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

function buildListUsersUrl() {
  const base = (
    process.env.USER_SERVICE_URL ||
    config.userService.url ||
    ""
  ).replace(/\/$/, "");
  const path =
    process.env.USER_SERVICE_LIST_PATH ||
    config.userService.listPath ||
    "/api/users/internal/list";

  if (!base) return "";
  return `${base}${path.startsWith("/") ? "" : "/"}${path}`;
}

function normalizeUserRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const userId = raw.userId || raw.id || raw.sub;
  const email = typeof raw.email === "string" ? raw.email.trim() : "";
  if (!isValidEmail(email)) return null;

  const role = raw.role?.name || raw.role;

  return {
    userId: userId ? String(userId) : "",
    email,
    name: raw.name || raw.fullName || raw.firstName || "",
    ...(role ? { role: String(role) } : {}),
  };
}

function extractUserListPayload(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.users)) return data.users;
  if (Array.isArray(data?.data)) return data.data;
  if (Array.isArray(data?.items)) return data.items;
  return [];
}

async function fetchUsersEndpoint(url, { method = "POST", body, fetcher, timeoutMs } = {}) {
  const fetchImpl = fetcher || global.fetch;
  const effectiveTimeout = timeoutMs || config.userService.timeoutMs || 5000;
  const serviceKey =
    process.env.INTERNAL_SERVICE_API_KEY ||
    process.env.SERVICE_API_KEY ||
    config.serviceApiKey;

  return usersCircuitBreaker.execute(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), effectiveTimeout);
    if (typeof timer.unref === "function") timer.unref();

    try {
      const headers = {
        "Content-Type": "application/json",
      };
      if (serviceKey) {
        headers["X-Service-Api-Key"] = serviceKey;
      }

      const fetchOptions = {
        method,
        headers,
        signal: controller.signal,
      };
      if (body !== undefined && method !== "GET") {
        fetchOptions.body = JSON.stringify(body);
      }

      const response = await fetchImpl(url, fetchOptions);

      if (!response.ok) {
        const err = new Error(
          `ms-usuarios respondió con HTTP ${response.status} al consultar usuarios`,
        );
        err.status = response.status;
        err.isPermanent =
          response.status >= 400 && response.status < 500 && response.status !== 429;
        throw err;
      }

      return response.json();
    } finally {
      clearTimeout(timer);
    }
  });
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

  const resolvedMap = new Map();
  const chunkSize = config.batch.idLookupChunkSize || 500;

  for (const chunk of chunkArray(uniqueIds, chunkSize)) {
    const data = await fetchUsersEndpoint(targetUrl, {
      method: "POST",
      body: { userIds: chunk },
      fetcher: options.fetcher,
    });
    const usersChunk = extractUserListPayload(data);

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

/**
 * Lista usuarios filtrados desde ms-usuarios (ej. todos o por rol).
 * Soporta paginación automática hasta `maxResults` cuando `fetchAll` es true.
 */
async function listUsersByFilter(
  { role, page = 1, limit = 500, fetchAll = true, maxResults } = {},
  options = {},
) {
  const baseListUrl = buildListUsersUrl();
  if (!baseListUrl) {
    const err = new Error(
      "USER_SERVICE_URL no configurada para listar usuarios desde ms-usuarios.",
    );
    err.code = "USER_SERVICE_NOT_CONFIGURED";
    err.isPermanent = true;
    throw err;
  }

  const maxAllowed = maxResults || config.batch.maxRecipients || 5000;
  const pageSize = Math.min(500, Math.max(1, Number(limit) || 500));
  const resolvedMap = new Map();
  let currentPage = Math.max(1, Number(page) || 1);

  while (resolvedMap.size < maxAllowed) {
    const urlObj = new URL(baseListUrl);
    urlObj.searchParams.set("page", String(currentPage));
    urlObj.searchParams.set("limit", String(pageSize));
    if (role && String(role).trim().toLowerCase() !== "all") {
      urlObj.searchParams.set("role", String(role).trim());
    }

    const data = await fetchUsersEndpoint(urlObj.toString(), {
      method: "GET",
      fetcher: options.fetcher,
    });
    const list = extractUserListPayload(data);

    for (const rawUser of list) {
      const normalized = normalizeUserRecord(rawUser);
      if (!normalized) continue;
      if (
        role &&
        String(role).trim().toLowerCase() !== "all" &&
        normalized.role &&
        normalized.role.toLowerCase() !== String(role).trim().toLowerCase()
      ) {
        continue;
      }
      const dedupeKey = normalized.userId || normalized.email.toLowerCase();
      if (!resolvedMap.has(dedupeKey)) {
        resolvedMap.set(dedupeKey, normalized);
      }
      if (resolvedMap.size >= maxAllowed) break;
    }

    const totalPages = Number(data?.pagination?.totalPages || data?.totalPages || 0);
    const hasMore =
      fetchAll &&
      list.length >= pageSize &&
      (!totalPages || currentPage < totalPages);

    if (!hasMore) break;
    currentPage += 1;
  }

  return Array.from(resolvedMap.values());
}

/**
 * Comprueba conectividad ligera con ms-usuarios sin abrir el circuito por errores de endpoint.
 */
async function checkUserServiceHealth(options = {}) {
  const base = (
    process.env.USER_SERVICE_URL ||
    config.userService.url ||
    ""
  ).replace(/\/$/, "");

  if (!base) {
    return { configured: false, ok: false, reason: "USER_SERVICE_URL no configurada" };
  }

  const fetchImpl = options.fetcher || global.fetch;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    options.timeoutMs || config.adminNotifications?.statusCheckTimeoutMs || 4000,
  );
  if (typeof timer.unref === "function") timer.unref();

  try {
    const res = await fetchImpl(`${base}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    return {
      configured: true,
      ok: res.ok,
      statusCode: res.status,
      latencyMs: Date.now() - startedAt,
    };
  } catch (err) {
    return {
      configured: true,
      ok: false,
      latencyMs: Date.now() - startedAt,
      error: err.message,
    };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  resolveUsersByIds,
  listUsersByFilter,
  checkUserServiceHealth,
  usersCircuitBreaker,
  buildBatchUsersUrl,
  buildListUsersUrl,
};
