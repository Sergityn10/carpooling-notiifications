const helmet = require("helmet");

/**
 * Middleware unificado de cabeceras de seguridad y hardening HTTP.
 * Da cumplimiento a LOW-01 a LOW-13 y MED-01 a MED-04 (HSTS, CSP, nosniff, DENY).
 */
const helmetMiddleware = helmet({
  // MED-01 a MED-04: Strict-Transport-Security (1 año, incluye subdominios y precarga)
  strictTransportSecurity: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
  // LOW-01 a LOW-13: Content-Security-Policy estricta para API REST
  contentSecurityPolicy: {
    useDefaults: false,
    directives: {
      defaultSrc: ["'self'"],
      baseUri: ["'self'"],
      fontSrc: ["'none'"],
      formAction: ["'self'"],
      frameAncestors: ["'none'"],
      imgSrc: ["'self'", "data:"],
      objectSrc: ["'none'"],
      scriptSrc: ["'none'"],
      styleSrc: ["'self'"],
      upgradeInsecureRequests: [],
    },
  },
  // Prevención de MIME sniffing
  xContentTypeOptions: true,
  // Prevención de Clickjacking
  xFrameOptions: { action: "deny" },
  // Control de referrer
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
  // Bloqueo de descargas automáticas en IE
  xDownloadOptions: true,
  // Bloqueo de políticas entre dominios de Adobe Flash y Acrobat
  xPermittedCrossDomainPolicies: { permittedPolicies: "none" },
  // Ocultación de X-Powered-By
  hidePoweredBy: true,
  // Protección XSS cruzada
  xXssProtection: true,
});

/**
 * Middleware para ofuscar banners e información de versiones (Server, X-Powered-By).
 */
function obfuscateBanners(req, res, next) {
  res.removeHeader("X-Powered-By");
  res.removeHeader("Server");
  next();
}

/**
 * Función de configuración de seguridad integral sobre una aplicación Express.
 *
 * @param {import('express').Express} app
 */
function applySecurityHeaders(app) {
  // Desactiva cabecera express nativa
  app.disable("x-powered-by");

  // Aplica helmet y ofuscación
  app.use(helmetMiddleware);
  app.use(obfuscateBanners);
}

module.exports = {
  applySecurityHeaders,
  helmetMiddleware,
  obfuscateBanners,
};
