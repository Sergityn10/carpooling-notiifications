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
};
