const deviceTokenService = require("../services/deviceTokenService");

async function registerDeviceToken(req, res, next) {
  try {
    console.log("registerDeviceToken", req.body);
    const { token, platform, deviceId, deviceName } = req.body;

    if (!token) return res.status(400).json({ error: "El campo 'token' es obligatorio" });

    const deviceToken = await deviceTokenService.registerDeviceToken(req.user, {
      token,
      platform,
      deviceId,
      deviceName,
    });

    res.status(201).json({ success: true, deviceToken });
  } catch (error) {
    next(error);
  }
}

async function listMyDeviceTokens(req, res, next) {
  try {
    const devices = await deviceTokenService.listUserDeviceTokens(req.user.userId);
    res.status(200).json({ success: true, devices });
  } catch (error) {
    next(error);
  }
}

async function deactivateDeviceToken(req, res, next) {
  try {
    const { token, deviceId } = req.body;

    if (!token && !deviceId) {
      return res.status(400).json({ error: "Se requiere 'token' o 'deviceId'" });
    }

    const removed = token
      ? await deviceTokenService.deactivateDeviceToken(req.user.userId, token)
      : await deviceTokenService.deactivateDevice(req.user.userId, deviceId);

    if (!removed) return res.status(404).json({ error: "Dispositivo no encontrado" });

    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  registerDeviceToken,
  listMyDeviceTokens,
  deactivateDeviceToken,
};
