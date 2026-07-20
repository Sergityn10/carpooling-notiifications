const pushService = require("../services/pushService");
const pushTemplateService = require("../services/pushTemplateService");
const deviceTokenService = require("../services/deviceTokenService");

async function sendToToken(req, res, next) {
  try {
    const { token, title, body, data, priority, channelId, badge } = req.body;

    if (!token)
      return res.status(400).json({ error: "El campo 'token' es obligatorio" });
    if (!title)
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    if (!body)
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });

    const result = await pushService.sendToToken(token, {
      title,
      body,
      data,
      priority,
      channelId,
      badge,
    });
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function sendToTokens(req, res, next) {
  try {
    const { tokens, title, body, data, priority, channelId, badge } = req.body;

    if (!Array.isArray(tokens) || tokens.length === 0) {
      return res.status(400).json({
        error: "Se requiere un array 'tokens' con al menos un elemento",
      });
    }
    if (!title)
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    if (!body)
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });

    const results = await pushService.sendToTokens(tokens, {
      title,
      body,
      data,
      priority,
      channelId,
      badge,
    });
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.status(200).json({
      success: true,
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    next(error);
  }
}

async function sendToUser(req, res, next) {
  try {
    const { userId, title, body, data, priority, channelId, badge } = req.body;

    if (!userId)
      return res
        .status(400)
        .json({ error: "El campo 'userId' es obligatorio" });
    if (!title)
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    if (!body)
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });

    const tokens = await deviceTokenService.getActiveTokensByUserId(
      String(userId),
    );
    if (tokens.length === 0) {
      return res.status(404).json({
        error: "El usuario no tiene dispositivos activos registrados",
      });
    }

    const results = await pushService.sendToTokens(tokens, {
      title,
      body,
      data,
      priority,
      channelId,
      badge,
    });
    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res.status(200).json({
      success: true,
      total: results.length,
      succeeded,
      failed,
      results,
    });
  } catch (error) {
    next(error);
  }
}

async function sendToTopic(req, res, next) {
  try {
    const { topic, title, body, data, priority } = req.body;

    if (!topic)
      return res.status(400).json({ error: "El campo 'topic' es obligatorio" });
    if (!title)
      return res.status(400).json({ error: "El campo 'title' es obligatorio" });
    if (!body)
      return res.status(400).json({ error: "El campo 'body' es obligatorio" });

    const result = await pushService.sendToTopic(topic, {
      title,
      body,
      data,
      priority,
    });
    res.status(200).json({ success: true, ...result });
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
    if (!topic)
      return res.status(400).json({ error: "El campo 'topic' es obligatorio" });

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
    if (!topic)
      return res.status(400).json({ error: "El campo 'topic' es obligatorio" });

    const result = await pushService.unsubscribeFromTopic(tokens, topic);
    res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

async function sendTemplatedToUser(req, res, next) {
  try {
    const { userId, template, data, priority, channelId, badge } = req.body;

    if (!userId)
      return res
        .status(400)
        .json({ error: "El campo 'userId' es obligatorio" });
    if (!template)
      return res
        .status(400)
        .json({ error: "El campo 'template' es obligatorio" });

    let rendered;
    try {
      rendered = pushTemplateService.renderPushTemplate(template, data || {});
    } catch (err) {
      return res.status(400).json({ error: err.message });
    }

    const tokens = await deviceTokenService.getActiveTokensByUserId(
      String(userId),
    );
    if (tokens.length === 0) {
      return res
        .status(404)
        .json({
          error: "El usuario no tiene dispositivos activos registrados",
        });
    }

    const results = await pushService.sendToTokens(tokens, {
      title: rendered.title,
      body: rendered.body,
      data: rendered.data,
      priority,
      channelId,
      badge,
    });

    const succeeded = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    res
      .status(200)
      .json({
        success: true,
        total: results.length,
        succeeded,
        failed,
        results,
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
