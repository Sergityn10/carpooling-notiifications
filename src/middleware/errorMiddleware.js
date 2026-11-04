const config = require("../config");

function notFound(req, res) {
  res.status(404).json({
    status: "Error",
    code: "NOT_FOUND",
    error: "Ruta no encontrada",
    path: req.originalUrl,
  });
}

function errorHandler(err, req, res, next) {
  // Registro estructurado del error
  console.error(`[ERROR ${new Date().toISOString()}] ${req.method} ${req.originalUrl}:`, err.message);

  // Manejo de Circuit Breaker abierto (CRIT-03)
  if (err.code === "CIRCUIT_BREAKER_OPEN") {
    if (err.retryAfter) {
      res.setHeader("Retry-After", err.retryAfter);
    }
    return res.status(503).json({
      status: "Error",
      code: "SERVICE_UNAVAILABLE",
      error: err.message,
      retryAfterSeconds: err.retryAfter || 30,
    });
  }

  // Manejo de Backpressure por saturación de cola (CRIT-03 / MED-23 a MED-25)
  if (err.code === "SERVER_OVERLOAD" || err.status === 503) {
    if (err.retryAfter) {
      res.setHeader("Retry-After", err.retryAfter);
    }
    return res.status(503).json({
      status: "Error",
      code: "SERVER_OVERLOAD",
      error:
        err.message ||
        "Servidor temporalmente saturado. Por favor, reintente en unos instantes.",
      retryAfterSeconds: err.retryAfter || 5,
    });
  }

  // Manejo de JSON malformado en el body
  if (err instanceof SyntaxError && err.status === 400 && "body" in err) {
    return res.status(400).json({
      status: "Error",
      code: "INVALID_JSON",
      error: "Cuerpo de la petición JSON malformado.",
    });
  }

  // Errores de conexión con proveedores SMTP / FCM
  if (
    err.code === "EAUTH" ||
    err.code === "ECONNECTION" ||
    err.code === "ETIMEDOUT" ||
    err.code === "OPERATION_TIMEOUT"
  ) {
    return res.status(502).json({
      status: "Error",
      code: "BAD_GATEWAY",
      error: "Error o timeout de comunicación con el servicio externo de notificaciones.",
      detail: config.nodeEnv === "development" ? err.message : undefined,
    });
  }

  // Errores generales (sin fuga de stack trace ni detalles internos en producción)
  const statusCode = err.status || err.statusCode || 500;
  return res.status(statusCode).json({
    status: "Error",
    code: err.code || "INTERNAL_ERROR",
    error: err.message || "Error interno del servidor",
    detail: config.nodeEnv === "development" ? err.stack : undefined,
  });
}

module.exports = { notFound, errorHandler };
