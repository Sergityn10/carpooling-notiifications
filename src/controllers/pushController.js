const pushService = require("../services/pushService");
const pushTemplateService = require("../services/pushTemplateService");
const deviceTokenService = require("../services/deviceTokenService");
const notificationQueue = require("../services/notificationQueue");
const { sanitizeString } = require("../security");

/**
 * Envío de push a un token de dispositivo individual.
 * CRIT-03: Por defecto procesa de forma asíncrona no bloqueante (202 Accepted)
 * para absorber ráfagas concurrentes sin colapsar el event loop.
 */
async function sendToToken(req, res, next) {
  try {
    const { token, title, body, data, priority, channelId, badge, sync } =
      req.body;

    if (!token) {
      return res.status(400).json({ error: "El campo 'token' es obligatorio" });
    }
    if (!title) {
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    }
    if (!body) {
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });
    }

    const payload = {
      token: String(token).trim(),
      title: sanitizeString(title, 200),
      body: sanitizeString(body, 1000),
      data: data || {},
      priority: priority || "high",
      channelId: channelId || "default",
      badge,
    };

    // Procesamiento síncrono opcional (sólo si se especifica explícitamente sync=true)
    if (sync === true || req.query.sync === "true") {
      const result = await pushService.sendToTokenDirect(payload.token, payload);
      return res.status(200).json({ success: true, ...result });
    }

    // Modo asíncrono no bloqueante (Recomendado y por defecto)
    const queueResult = await notificationQueue.enqueuePush(payload);
    return res.status(202).json({
      success: true,
      message: "Notificación push encolada satisfactoriamente para su entrega.",
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío masivo de push a múltiples tokens (Multicast).
 * Requiere rol administrador o servicio interno.
 */
async function sendToTokens(req, res, next) {
  try {
    const { tokens, title, body, data, priority, channelId, badge, sync } =
      req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'tokens' con al menos un elemento",
      });
    }
    if (!title) {
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    }
    if (!body) {
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });
    }

    const payload = {
      tokens,
      title: sanitizeString(title, 200),
      body: sanitizeString(body, 1000),
      data: data || {},
      priority: priority || "high",
      channelId: channelId || "default",
      badge,
    };

    if (sync === true || req.query.sync === "true") {
      const results = await pushService.sendToTokensDirect(tokens, payload);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return res.status(200).json({
        success: true,
        total: results.length,
        succeeded,
        failed,
        results,
      });
    }

    const queueResult = await notificationQueue.enqueuePush(payload);
    return res.status(202).json({
      success: true,
      message: "Envío masivo encolado satisfactoriamente.",
      totalTokens: tokens.length,
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío de push a todos los dispositivos registrados de un usuario.
 * Control ABAC: Un usuario común sólo puede auto-notificarse; admins o servicios pueden notificar a cualquiera.
 */
async function sendToUser(req, res, next) {
  try {
    const { userId, title, body, data, priority, channelId, badge, sync } =
      req.body;

    if (!userId) {
      return res.status(400).json({ error: "El campo 'userId' es obligatorio" });
    }
    if (!title) {
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    }
    if (!body) {
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });
    }

    // Control de autorización (BOLA / Ownership)
    const targetUserId = String(userId);
    const requesterId = String(req.user.userId || req.user.id);
    const isPrivileged = req.user.role === "admin" || req.user.isService;

    if (!isPrivileged && requesterId !== targetUserId) {
      return res.status(403).json({
        status: "Error",
        code: "ACCESS_DENIED",
        error: "Acceso denegado: no puedes emitir notificaciones a otros usuarios.",
      });
    }

    const tokens = await deviceTokenService.getActiveTokensByUserId(targetUserId);
    if (tokens.length === 0) {
      return res.status(404).json({
        error: "El usuario no tiene dispositivos activos registrados",
      });
    }

    const payload = {
      tokens,
      userId: targetUserId,
      title: sanitizeString(title, 200),
      body: sanitizeString(body, 1000),
      data: data || {},
      priority: priority || "high",
      channelId: channelId || "default",
      badge,
    };

    if (sync === true || req.query.sync === "true") {
      const results = await pushService.sendToTokensDirect(tokens, payload);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return res.status(200).json({
        success: true,
        total: results.length,
        succeeded,
        failed,
        results,
      });
    }

    const queueResult = await notificationQueue.enqueuePush(payload);
    return res.status(202).json({
      success: true,
      message: "Notificación de usuario encolada satisfactoriamente.",
      deviceCount: tokens.length,
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío a tópicos generales de Firebase.
 * Restringido a administradores (MED-08).
 */
async function sendToTopic(req, res, next) {
  try {
    const { topic, title, body, data, priority, sync } = req.body;

    if (!topic) {
      return res.status(400).json({ error: "El campo 'topic' es obligatorio" });
    }
    if (!title) {
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    }
    if (!body) {
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });
    }

    const payload = {
      topic: String(topic).trim(),
      title: sanitizeString(title, 200),
      body: sanitizeString(body, 1000),
      data: data || {},
      priority: priority || "high",
    };

    if (sync === true || req.query.sync === "true") {
      const result = await pushService.sendToTopicDirect(payload.topic, payload);
      return res.status(200).json({ success: true, ...result });
    }

    const queueResult = await notificationQueue.enqueuePush(payload);
    return res.status(202).json({
      success: true,
      message: "Notificación a tópico encolada satisfactoriamente.",
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

async function subscribeToTopic(req, res, next) {
  try {
    const { tokens, topic } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'tokens' con al menos un elemento",
      });
    }
    if (!topic) {
      return res.status(400).json({ error: "El campo 'topic' es obligatorio" });
    }

    const result = await pushService.subscribeToTopic(tokens, topic);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function unsubscribeFromTopic(req, res, next) {
  try {
    const { tokens, topic } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'tokens' con al menos un elemento",
      });
    }
    if (!topic) {
      return res.status(400).json({ error: "El campo 'topic' es obligatorio" });
    }

    const result = await pushService.unsubscribeFromTopic(tokens, topic);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function sendTemplatedToUser(req, res, next) {
  try {
    const { userId, template, data, priority, channelId, badge, sync } =
      req.body;

    if (!userId) {
      return res.status(400).json({ error: "El campo 'userId' es obligatorio" });
    }
    if (!template) {
      return res.status(400).json({ error: "El campo 'template' es obligatorio" });
    }

    const targetUserId = String(userId);
    const requesterId = String(req.user.userId || req.user.id);
    const isPrivileged = req.user.role === "admin" || req.user.isService;

    if (!isPrivileged && requesterId !== targetUserId) {
      return res.status(403).json({
        status: "Error",
        code: "ACCESS_DENIED",
        error: "Acceso denegado: no puedes emitir notificaciones a otros usuarios.",
      });
    }

    let rendered;
    try {
      rendered = pushTemplateService.renderPushTemplate(template, data || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const tokens = await deviceTokenService.getActiveTokensByUserId(targetUserId);
    if (tokens.length === 0) {
      return res.status(404).json({
        error: "El usuario no tiene dispositivos activos registrados",
      });
    }

    const payload = {
      tokens,
      userId: targetUserId,
      title: rendered.title,
      body: rendered.body,
      data: rendered.data,
      priority,
      channelId,
      badge,
    };

    if (sync === true || req.query.sync === "true") {
      const results = await pushService.sendToTokensDirect(tokens, payload);
      const succeeded = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success).length;

      return res.status(200).json({
        success: true,
        total: results.length,
        succeeded,
        failed,
        results,
      });
    }

    const queueResult = await notificationQueue.enqueuePush(payload);
    return res.status(202).json({
      success: true,
      message: "Notificación de plantilla encolada satisfactoriamente.",
      deviceCount: tokens.length,
      ...queueResult,
    });
  } catch (error) {
    next(error);
  }
}

module.exports = {
  sendToToken,
  sendToTokens,
  sendToUser,
  sendTemplatedToUser,
  sendToTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
};
