const notificationOrchestrator = require("../services/notificationOrchestrator");
const { listNotificationTypes } = require("../templates/notificationCatalog");

/**
 * Envío batch multi-canal basado en catálogo de plantillas y userIds.
 * POST /api/notifications/batch
 */
async function sendBatch(req, res, next) {
  try {
    const idempotencyKey =
      req.body?.idempotencyKey || req.headers["idempotency-key"] || undefined;

    const result = await notificationOrchestrator.dispatchBatch({
      ...req.body,
      idempotencyKey,
    });

    return res.status(202).json({
      success: true,
      message: result.deduplicated
        ? "Lote ya procesado previamente (idempotencia)."
        : "Lote de notificaciones encolado satisfactoriamente.",
      ...result,
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Lista los tipos de notificación disponibles en el catálogo y sus campos requeridos.
 * GET /api/notifications/catalog
 */
function getCatalog(req, res) {
  return res.status(200).json({
    types: listNotificationTypes(),
  });
}

module.exports = {
  sendBatch,
  getCatalog,
};
