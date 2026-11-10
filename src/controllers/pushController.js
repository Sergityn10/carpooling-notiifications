const { v4: uuidv4 } = require("uuid");
const config = require("../config");
const pushService = require("../services/pushService");
const pushTemplateService = require("../services/pushTemplateService");
const deviceTokenService = require("../services/deviceTokenService");
const notificationQueue = require("../services/notificationQueue");
const pushChannel = require("../services/channels/pushChannel");
const { sanitizeString } = require("../security");
const { deduplicateIds } = require("../utils/templateInterpolator");

/**
 * Envío de push a un token de dispositivo individual.
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

    if (sync === true || req.query.sync === "true") {
      const result = await pushService.sendToTokenDirect(payload.token, payload);
      return res.status(200).json({ success: true, ...result });
    }

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
 * Envío masivo de push a una lista de userIds en una sola llamada.
 * Delega la consulta bulk de tokens a los workers en segundo plano (sin N+1 ni bloqueo HTTP).
 * POST /api/push/send/users
 */
async function sendToUsersBatch(req, res, next) {
  try {
    const {
      userIds,
      template,
      data = {},
      title,
      body,
      priority = "high",
      channelId = "default",
      badge,
    } = req.body;

    const uniqueUserIds = deduplicateIds(userIds);
    if (uniqueUserIds.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'userIds' con al menos un identificador válido",
      });
    }

    const maxRecipients = config.batch.maxRecipients || 5000;
    if (uniqueUserIds.length > maxRecipients) {
      return res.status(400).json({
        error: `El lote excede el máximo permitido (${maxRecipients} usuarios)`,
      });
    }

    let finalTitle;
    let finalBody;
    let finalData = data || {};

    if (template) {
      try {
        const rendered = pushTemplateService.renderPushTemplate(template, data);
        finalTitle = rendered.title;
        finalBody = rendered.body;
        finalData = { ...rendered.data, ...(data || {}) };
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
    } else {
      if (!title) {
        return res.status(400).json({
          error: "Se requiere 'template' o los campos 'title' y 'body'",
        });
      }
      if (!body) {
        return res.status(400).json({ error: "El campo 'body' es obligatorio" });
      }
      finalTitle = sanitizeString(title, 200);
      finalBody = sanitizeString(body, 1000);
    }

    const batchId = uuidv4();
    const result = await pushChannel.enqueueBatch({
      batchId,
      title: finalTitle,
      body: finalBody,
      data: finalData,
      priority,
      channelId,
      badge,
      userIds: uniqueUserIds,
    });

    return res.status(202).json({
      success: true,
      message: "Lote de notificaciones push por usuarios encolado satisfactoriamente.",
      batchId,
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Envío de push a todos los dispositivos registrados de un usuario.
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
  sendToUsersBatch,
  sendToUser,
  sendTemplatedToUser,
  sendToTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
};
