const rateLimit = require("express-rate-limit");

/**
 * Generador de claves para Rate Limiting:
 * Si el usuario está autenticado, limita por su userId; de lo contrario por su IP real.
 */
function defaultKeyGenerator(req) {
  if (req.user && (req.user.userId || req.user.id)) {
    return `user:${req.user.userId || req.user.id}`;
  }
  // Limpieza de IPv6 loopback / forwarded IPs
  const forwarded = req.headers["x-forwarded-for"];
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.ip || req.socket?.remoteAddress || "anonymous";
}

/**
 * Manejador estándar de exceso de peticiones (HTTP 429 Too Many Requests).
 */
function defaultRateLimitHandler(customMessage) {
  return (req, res, next, options) => {
    const retryAfter = Math.ceil(options.windowMs / 1000);
    res.setHeader("Retry-After", retryAfter);

    return res.status(429).json({
      status: "Error",
      code: "TOO_MANY_REQUESTS",
      error:
        customMessage ||
        "Se ha excedido el límite de peticiones permitido. Por favor, espere antes de reintentar.",
      retryAfterSeconds: retryAfter,
    });
  };
}

/**
 * Fábrica genérica de limitadores de tasa (Rate Limiters).
 *
 * @param {object} options
 * @param {number} options.windowMs - Ventana de tiempo en milisegundos
 * @param {number} options.max - Número máximo de peticiones permitidas en la ventana
 * @param {string} options.message - Mensaje de error personalizado
 * @param {Function} [options.keyGenerator] - Generador de clave (IP o User)
 * @param {boolean} [options.skipSuccessfulRequests] - No computar peticiones exitosas (opcional)
 */
function createRateLimiter({
  windowMs = 60 * 1000,
  max = 100,
  message = "Demasiadas peticiones. Inténtelo más tarde.",
  keyGenerator = defaultKeyGenerator,
  skipSuccessfulRequests = false,
  skip = () => false,
}) {
  return rateLimit({
    windowMs,
    max,
    standardHeaders: true, // Cabeceras estándar IETF (RateLimit-Limit, RateLimit-Remaining, RateLimit-Reset)
    legacyHeaders: false, // Desactiva cabeceras antiguas X-RateLimit-*
    keyGenerator,
    skipSuccessfulRequests,
    skip,
    validate: {
      keyGeneratorIpFallback: false,
      xForwardedForHeader: false,
      default: false,
    },
    handler: defaultRateLimitHandler(message),
  });
}

/**
 * Rate Limiter para Autenticación (Anti Fuerza Bruta y Credential Stuffing).
 * ALTO-13, MED-05: 5 peticiones cada 15 minutos por IP.
 */
const authRateLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutos
  max: 5,
  message:
    "Demasiados intentos de autenticación fallidos. Por seguridad, intente de nuevo en 15 minutos.",
  keyGenerator: (req) => {
    const forwarded = req.headers["x-forwarded-for"];
    return forwarded ? forwarded.split(",")[0].trim() : req.ip || "auth-ip";
  },
});

/**
 * Rate Limiter para Transacciones Financieras y Monederos.
 * ALTO-16, ALTO-17: 10 peticiones por minuto por usuario o IP.
 */
const paymentRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minuto
  max: 10,
  message:
    "Límite de operaciones de pago/monedero superado. Por favor, espere 1 minuto.",
  keyGenerator: defaultKeyGenerator,
});

/**
 * Rate Limiter para Envío de Notificaciones Push y Emails Individuales.
 * CRIT-03, MED-23 a MED-25: Previene saturación y DoS con 30 peticiones por minuto.
 */
const notificationBurstLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minuto
  max: 30,
  message:
    "Ha superado la tasa máxima de envío de notificaciones. Espere un momento.",
  keyGenerator: defaultKeyGenerator,
  skip: (req) => req.user && req.user.isService === true,
});

/**
 * Rate Limiter Estricto para Operaciones Masivas (Multicast, Topics, Lotes de email).
 * MED-08, MED-09: 5 peticiones por minuto para proteger recursos de terceros (FCM/SMTP).
 */
const bulkNotificationLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minuto
  max: 5,
  message:
    "Límite de envíos masivos excedido. Máximo 5 operaciones masivas por minuto.",
  keyGenerator: defaultKeyGenerator,
  skip: (req) => req.user && req.user.isService === true,
});

/**
 * Rate Limiter General de API YouConnext.
 * MED-10 a MED-22: 100 peticiones por minuto por token/IP.
 */
const generalApiLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minuto
  max: 100,
  message: "Ha excedido el límite general de solicitudes de la API.",
  keyGenerator: defaultKeyGenerator,
});

module.exports = {
  createRateLimiter,
  authRateLimiter,
  paymentRateLimiter,
  notificationBurstLimiter,
  bulkNotificationLimiter,
  generalApiLimiter,
};
