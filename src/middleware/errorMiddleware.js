function notFound(req, res) {
  res.status(404).json({ error: "Ruta no encontrada", path: req.originalUrl });
}

function errorHandler(err, req, res, next) {
  console.error("[ERROR]", err.message);

  if (err.code === "EAUTH" || err.code === "ECONNECTION" || err.code === "ETIMEDOUT") {
    return res.status(502).json({
      error: "Error de conexión con el servidor SMTP",
      detail: err.message,
    });
  }

  res.status(500).json({
    error: "Error interno del servidor",
    detail: err.message,
  });
}

module.exports = { notFound, errorHandler };
