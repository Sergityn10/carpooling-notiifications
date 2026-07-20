const prisma = require("../lib/prisma");

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

async function deactivateDeviceToken(userId, token) {
  const result = await prisma.userDeviceToken.updateMany({
    where: { userId, token },
    data: { active: false },
  });

  return result.count > 0;
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

module.exports = {
  registerDeviceToken,
  listUserDeviceTokens,
  listDeviceTokensByUserId,
  listAllDeviceTokens,
  deactivateDeviceToken,
  deactivateDevice,
  getActiveTokensByUserId,
};
