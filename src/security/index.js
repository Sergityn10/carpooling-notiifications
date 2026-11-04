/**
 * YouConnext Shared Security Kit
 * ==============================
 * Módulo reutilizable de seguridad transversal para microservicios YouConnext.
 * Cumple con DAST, OWASP API Top 10 (2023), RGPD y directivas PSD2.
 */

const jwtAuth = require("./jwtAuth");
const rateLimiter = require("./rateLimiter");
const securityHeaders = require("./securityHeaders");
const CircuitBreaker = require("./circuitBreaker");
const sanitizer = require("./sanitizer");

module.exports = {
  // Autenticación JWT y Autorización RBAC / ABAC (CRIT-01, CRIT-02, HIGH-06, HIGH-07)
  ALLOWED_ALGORITHMS: jwtAuth.ALLOWED_ALGORITHMS,
  extractBearerToken: jwtAuth.extractBearerToken,
  verifyStrictToken: jwtAuth.verifyStrictToken,
  requireAuth: jwtAuth.requireAuth,
  requireRole: jwtAuth.requireRole,
  requireAdmin: jwtAuth.requireAdmin,
  requireOwnership: jwtAuth.requireOwnership,

  // Rate Limiting Multicapa (ALTO-13 a ALTO-17, MED-05, MED-10 a MED-25)
  createRateLimiter: rateLimiter.createRateLimiter,
  authRateLimiter: rateLimiter.authRateLimiter,
  paymentRateLimiter: rateLimiter.paymentRateLimiter,
  notificationBurstLimiter: rateLimiter.notificationBurstLimiter,
  bulkNotificationLimiter: rateLimiter.bulkNotificationLimiter,
  generalApiLimiter: rateLimiter.generalApiLimiter,

  // Cabeceras HTTP y Hardening (LOW-01 a LOW-13, MED-01 a MED-04)
  applySecurityHeaders: securityHeaders.applySecurityHeaders,
  helmetMiddleware: securityHeaders.helmetMiddleware,
  obfuscateBanners: securityHeaders.obfuscateBanners,

  // Patrón de Resiliencia Circuit Breaker (CRIT-03, CRIT-04)
  CircuitBreaker,

  // Sanitización y DTOs de salida limpios (HIGH-01, RGPD)
  isValidEmail: sanitizer.isValidEmail,
  sanitizeString: sanitizer.sanitizeString,
  sanitizeOutput: sanitizer.sanitizeOutput,
};
