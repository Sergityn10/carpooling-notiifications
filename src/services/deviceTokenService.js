const prisma = require("../lib/prisma");
const { chunkArray, deduplicateIds } = require("../utils/templateInterpolator");

const USER_ID_QUERY_CHUNK_SIZE = 1000;

async function registerDeviceToken(user, payload) {
  const { token, platform, deviceId, deviceName } = payload;

  const data = {
    userId: user.userId,
    email: user.email,
    role: user.role,
    token,
    platform,
    deviceId,
    deviceName,
    active: true,
    lastUsedAt: new Date(),
  };

  if (deviceId) {
    const existingByDevice = await prisma.userDeviceToken.findUnique({
      where: { userId_deviceId: { userId: user.userId, deviceId } },
    });

    if (existingByDevice) {
      return prisma.userDeviceToken.update({
        where: { id: existingByDevice.id },
        data,
      });
    }
  }

  return prisma.userDeviceToken.upsert({
    where: { token },
    update: data,
    create: data,
  });
}

function listUserDeviceTokens(userId) {
  return prisma.userDeviceToken.findMany({
    where: { userId, active: true },
    orderBy: { lastUsedAt: "desc" },
  });
}

function listDeviceTokensByUserId(userId) {
  return prisma.userDeviceToken.findMany({
    where: { userId },
    orderBy: { lastUsedAt: "desc" },
  });
}

function listAllDeviceTokens() {
  return prisma.userDeviceToken.findMany({
    orderBy: { lastUsedAt: "desc" },
  });
}

/**
 * Desactiva un token FCM. Si userId es null/undefined, desactiva por token único.
 */
async function deactivateDeviceToken(userId, token) {
  if (!token) return false;

  const where = userId
    ? { userId: String(userId), token: String(token) }
    : { token: String(token) };

  const result = await prisma.userDeviceToken.updateMany({
    where,
    data: { active: false },
  });

  return result.count > 0;
}

/**
 * Desactiva múltiples tokens FCM inválidos o expirados en operaciones por lote.
 */
async function deactivateTokensBulk(tokens) {
  const uniqueTokens = deduplicateIds(tokens);
  if (uniqueTokens.length === 0) return 0;

  let deactivatedCount = 0;
  for (const chunk of chunkArray(uniqueTokens, USER_ID_QUERY_CHUNK_SIZE)) {
    const result = await prisma.userDeviceToken.updateMany({
      where: {
        token: { in: chunk },
        active: true,
      },
      data: { active: false },
    });
    deactivatedCount += result.count || 0;
  }

  return deactivatedCount;
}

async function deactivateDevice(userId, deviceId) {
  const result = await prisma.userDeviceToken.updateMany({
    where: { userId, deviceId },
    data: { active: false },
  });

  return result.count > 0;
}

async function getActiveTokensByUserId(userId) {
  const rows = await prisma.userDeviceToken.findMany({
    where: { userId, active: true },
    select: { token: true },
  });

  return rows.map((row) => row.token);
}

/**
 * Resuelve todos los tokens FCM activos para una lista de userIds en consultas bulk.
 * Elimina el problema de consultas N+1 en envíos batch.
 */
async function getActiveTokensByUserIds(userIds) {
  const uniqueUserIds = deduplicateIds(userIds);
  const tokensByUser = new Map();
  const uniqueTokensSet = new Set();

  if (uniqueUserIds.length === 0) {
    return { tokens: [], tokensByUser };
  }

  for (const chunk of chunkArray(uniqueUserIds, USER_ID_QUERY_CHUNK_SIZE)) {
    const rows = await prisma.userDeviceToken.findMany({
      where: {
        userId: { in: chunk },
        active: true,
      },
      select: {
        userId: true,
        token: true,
      },
    });

    for (const row of rows) {
      if (!row.token) continue;
      uniqueTokensSet.add(row.token);

      if (!tokensByUser.has(row.userId)) {
        tokensByUser.set(row.userId, []);
      }
      tokensByUser.get(row.userId).push(row.token);
    }
  }

  return {
    tokens: Array.from(uniqueTokensSet),
    tokensByUser,
  };
}

/**
 * Fallback opcional solo para desarrollo: obtiene emails conocidos desde UserDeviceToken.
 */
async function getKnownEmailsByUserIds(userIds) {
  const uniqueUserIds = deduplicateIds(userIds);
  if (uniqueUserIds.length === 0) return [];

  const byUser = new Map();
  for (const chunk of chunkArray(uniqueUserIds, USER_ID_QUERY_CHUNK_SIZE)) {
    const rows = await prisma.userDeviceToken.findMany({
      where: {
        userId: { in: chunk },
        active: true,
      },
      select: {
        userId: true,
        email: true,
      },
      orderBy: { lastUsedAt: "desc" },
    });

    for (const row of rows) {
      if (row.email && !byUser.has(row.userId)) {
        byUser.set(row.userId, {
          userId: row.userId,
          email: row.email,
          name: "",
        });
      }
    }
  }

  return Array.from(byUser.values());
}

/**
 * Construye una cláusula `where` de Prisma a partir de filtros administrativos.
 */
function buildAdminDeviceWhere(filter = {}, { activeOnly = true } = {}) {
  const where = {};

  if (activeOnly) {
    where.active = true;
  } else if (typeof filter.active === "boolean") {
    where.active = filter.active;
  }

  if (filter.role && String(filter.role).trim().toLowerCase() !== "all") {
    where.role = String(filter.role).trim();
  }

  if (filter.platform && String(filter.platform).trim().toLowerCase() !== "all") {
    where.platform = String(filter.platform).trim().toLowerCase();
  }

  const userIds = deduplicateIds([
    ...(filter.userId ? [filter.userId] : []),
    ...(Array.isArray(filter.userIds) ? filter.userIds : []),
  ]);
  if (userIds.length === 1) {
    where.userId = userIds[0];
  } else if (userIds.length > 1) {
    where.userId = { in: userIds };
  }

  const emails = deduplicateIds([
    ...(filter.email ? [String(filter.email).trim().toLowerCase()] : []),
    ...(Array.isArray(filter.emails)
      ? filter.emails.map((e) => String(e).trim().toLowerCase())
      : []),
  ]);
  if (emails.length === 1) {
    where.email = emails[0];
  } else if (emails.length > 1) {
    where.email = { in: emails };
  }

  const tokens = deduplicateIds([
    ...(filter.token ? [filter.token] : []),
    ...(Array.isArray(filter.tokens) ? filter.tokens : []),
  ]);
  if (tokens.length === 1) {
    where.token = tokens[0];
  } else if (tokens.length > 1) {
    where.token = { in: tokens };
  }

  if (filter.search && String(filter.search).trim()) {
    const term = String(filter.search).trim();
    where.OR = [
      { email: { contains: term } },
      { userId: { contains: term } },
      { deviceName: { contains: term } },
    ];
  }

  return where;
}

/**
 * Resuelve dispositivos y usuarios activos que cumplen los filtros indicados.
 */
async function findActiveTargetsByFilter(filter = {}) {
  const where = buildAdminDeviceWhere(filter, { activeOnly: true });
  const rows = await prisma.userDeviceToken.findMany({
    where,
    select: {
      userId: true,
      email: true,
      role: true,
      platform: true,
      token: true,
      deviceName: true,
      lastUsedAt: true,
    },
    orderBy: { lastUsedAt: "desc" },
  });

  const tokenSet = new Set();
  const usersMap = new Map();
  const platformCounts = {};

  for (const row of rows) {
    if (row.token) {
      tokenSet.add(row.token);
      const plat = row.platform || "unknown";
      platformCounts[plat] = (platformCounts[plat] || 0) + 1;
    }
    if (row.userId && !usersMap.has(row.userId)) {
      usersMap.set(row.userId, {
        userId: row.userId,
        email: row.email || "",
        role: row.role || "",
        name: "",
      });
    }
  }

  return {
    tokens: Array.from(tokenSet),
    users: Array.from(usersMap.values()),
    totalDevices: tokenSet.size,
    uniqueUsers: usersMap.size,
    byPlatform: platformCounts,
  };
}

/**
 * Obtiene estadísticas agregadas de tokens FCM para el panel de estado de administración.
 */
async function getDeviceTokenStats() {
  const [total, active, byPlatformRows, byRoleRows, uniqueActiveUsersRows] =
    await Promise.all([
      prisma.userDeviceToken.count(),
      prisma.userDeviceToken.count({ where: { active: true } }),
      prisma.userDeviceToken.groupBy({
        by: ["platform"],
        where: { active: true },
        _count: { _all: true },
      }),
      prisma.userDeviceToken.groupBy({
        by: ["role"],
        where: { active: true },
        _count: { _all: true },
      }),
      prisma.userDeviceToken.groupBy({
        by: ["userId"],
        where: { active: true },
      }),
    ]);

  const byPlatform = {};
  for (const row of byPlatformRows) {
    byPlatform[row.platform || "unknown"] = row._count._all;
  }

  const byRole = {};
  for (const row of byRoleRows) {
    byRole[row.role || "unknown"] = row._count._all;
  }

  return {
    total,
    active,
    inactive: Math.max(0, total - active),
    uniqueActiveUsers: uniqueActiveUsersRows.length,
    byPlatform,
    byRole,
  };
}

/**
 * Lista dispositivos registrados con paginación y filtros para el selector del panel admin.
 */
async function listDeviceTokensPaginated({
  page = 1,
  limit = 25,
  active,
  role,
  platform,
  search,
} = {}) {
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 25));
  const skip = (safePage - 1) * safeLimit;

  const where = buildAdminDeviceWhere(
    { active, role, platform, search },
    { activeOnly: active === undefined ? false : active === true },
  );

  const [items, total] = await Promise.all([
    prisma.userDeviceToken.findMany({
      where,
      select: {
        id: true,
        userId: true,
        email: true,
        role: true,
        platform: true,
        deviceId: true,
        deviceName: true,
        active: true,
        lastUsedAt: true,
        createdAt: true,
      },
      orderBy: { lastUsedAt: "desc" },
      skip,
      take: safeLimit,
    }),
    prisma.userDeviceToken.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page: safePage,
      limit: safeLimit,
      total,
      totalPages: Math.max(1, Math.ceil(total / safeLimit)),
    },
  };
}

module.exports = {
  registerDeviceToken,
  listUserDeviceTokens,
  listDeviceTokensByUserId,
  listAllDeviceTokens,
  deactivateDeviceToken,
  deactivateTokensBulk,
  deactivateDevice,
  getActiveTokensByUserId,
  getActiveTokensByUserIds,
  getKnownEmailsByUserIds,
  findActiveTargetsByFilter,
  getDeviceTokenStats,
  listDeviceTokensPaginated,
};
