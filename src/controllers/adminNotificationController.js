const adminNotificationService = require("../services/adminNotificationService");
const deviceTokenService = require("../services/deviceTokenService");
const { sanitizeOutput } = require("../security");

function getRequesterMeta(req) {
  if (!req.user) return null;
  return {
    userId: req.user.userId || req.user.id,
    email: req.user.email || null,
    role: req.user.role,
  };
}

/**
 * GET /api/admin/notifications/status
 * Diagnóstico completo de la API (BD, SMTP, Firebase/FCM, RabbitMQ, Circuit Breakers, Tokens).
 */
async function getStatus(req, res, next) {
  try {
    const checkUserService = req.query.checkUserService === "true";
    const status = await adminNotificationService.getApiStatus({
      checkUserService,
    });
    return res.status(200).json({ success: true, ...status });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/notifications/history
 * Historial reciente en memoria de envíos lanzados desde administración.
 */
function getHistory(req, res, next) {
  try {
    const { limit, kind } = req.query;
    const history = adminNotificationService.listAdminHistory({ limit, kind });
    return res.status(200).json({ success: true, ...history });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/notifications/jobs/:batchId
 * Consulta el estado registrado de un envío admin por su batchId.
 */
function getJobStatus(req, res, next) {
  try {
    const { batchId } = req.params;
    const job = adminNotificationService.getAdminJobStatus(batchId);
    if (!job) {
      return res.status(404).json({
        status: "Error",
        code: "JOB_NOT_FOUND",
        error: `No se encontró el envío '${batchId}' en el historial reciente.`,
      });
    }
    return res.status(200).json({ success: true, job });
  } catch (error) {
    next(error);
  }
}

/**
 * GET /api/admin/notifications/recipients
 * Lista paginada y filtrable de usuarios/dispositivos conocidos para selector del frontend admin.
 */
async function listRecipients(req, res, next) {
  try {
    const { page, limit, active, role, platform, search } = req.query;
    let parsedActive;
    if (active === "true") parsedActive = true;
    else if (active === "false") parsedActive = false;

    const result = await deviceTokenService.listDeviceTokensPaginated({
      page,
      limit,
      active: parsedActive,
      role,
      platform,
      search,
    });

    return res.status(200).json({
      success: true,
      ...sanitizeOutput(result),
    });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/notifications/preview
 * Previsualiza cuántos destinatarios/dispositivos coinciden con los filtros seleccionados.
 */
async function previewRecipients(req, res, next) {
  try {
    const result = await adminNotificationService.previewRecipients(req.body);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/notifications/email
 * Envío de correo personalizado SOLO ADMIN con filtros ('all', 'single', 'users', 'filter').
 */
async function sendCustomEmail(req, res, next) {
  try {
    const sync = req.body?.sync === true || req.query.sync === "true";
    const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";

    const result = await adminNotificationService.sendAdminEmail({
      ...req.body,
      sync,
      dryRun,
      requestedBy: getRequesterMeta(req),
    });

    const statusCode = dryRun || sync ? 200 : 202;
    return res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/notifications/push
 * Envío de notificación push personalizada SOLO ADMIN con filtros ('all', 'single', 'users', 'filter').
 */
async function sendCustomPush(req, res, next) {
  try {
    const sync = req.body?.sync === true || req.query.sync === "true";
    const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";

    const result = await adminNotificationService.sendAdminPush({
      ...req.body,
      sync,
      dryRun,
      requestedBy: getRequesterMeta(req),
    });

    const statusCode = dryRun || sync ? 200 : 202;
    return res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
}

/**
 * POST /api/admin/notifications/send
 * Envío unificado multi-canal (Push + Email) SOLO ADMIN con los mismos filtros.
 */
async function sendMultiChannel(req, res, next) {
  try {
    const sync = req.body?.sync === true || req.query.sync === "true";
    const dryRun = req.body?.dryRun === true || req.query.dryRun === "true";

    const result = await adminNotificationService.sendAdminMultiChannel({
      ...req.body,
      sync,
      dryRun,
      requestedBy: getRequesterMeta(req),
    });

    const statusCode = dryRun || sync ? 200 : 202;
    return res.status(statusCode).json(result);
  } catch (error) {
    next(error);
  }
}

module.exports = {
  getStatus,
  getHistory,
  getJobStatus,
  listRecipients,
  previewRecipients,
  sendCustomEmail,
  sendCustomPush,
  sendMultiChannel,
};
