const jwt = require("jsonwebtoken");
const config = require("../config");

// Lista blanca estricta de algoritmos criptográficos asimétricos permitidos.
// Prohíbe explícitamente "none", algoritmos simétricos (HS256) y variantes inseguras (CRIT-01).
const ALLOWED_ALGORITHMS = ["RS256"];

/**
 * Obtiene y normaliza la clave pública RSA configurada.
 */
function getPublicKey() {
  const rawKey = process.env.JWT_PUBLIC_KEY || config.jwtPublicKey || "";
  if (!rawKey) {
    return null;
  }
  return rawKey.replace(/\\n/g, "\n").trim();
}

/**
 * Extrae el Bearer token de las cabeceras HTTP de forma segura.
 * Soporta cabeceras en mayúsculas o minúsculas y elimina espacios superfluos.
 */
function extractBearerToken(req) {
  if (!req || !req.headers) return null;

  const rawHeader =
    req.headers.authorization ||
    req.headers.Authorization ||
    req.headers.authentication ||
    req.headers.Authentication;

  if (!rawHeader || typeof rawHeader !== "string") return null;

  const parts = rawHeader.trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const [scheme, token] = parts;
  if (scheme.toLowerCase() !== "bearer" || !token) return null;

  return token.trim();
}

/**
 * Extrae la clave interna de servicio (service-to-service) si está presente.
 */
function extractServiceApiKey(req) {
  if (!req || !req.headers) return null;
  return (
    req.headers["x-service-api-key"] ||
    req.headers["x-internal-api-key"] ||
    null
  );
}

/**
 * Valida de forma estricta un token JWT utilizando exclusivamente RS256.
 * CRIT-01 & CRIT-02: Rechaza tokens sin firma, con algoritmo none o firma inválida.
 *
 * @param {string} token
 * @returns {object} payload verificado
 */
function verifyStrictToken(token) {
  if (!token || typeof token !== "string") {
    const err = new Error("TOKEN_MISSING");
    err.code = "TOKEN_MISSING";
    throw err;
  }

  const publicKey = getPublicKey();
  if (!publicKey) {
    const err = new Error("JWT_PUBLIC_KEY_NOT_CONFIGURED");
    err.code = "SERVER_CONFIG_ERROR";
    throw err;
  }

  // Verificación forzada con algoritmos permitidos (RS256)
  return jwt.verify(token, publicKey, {
    algorithms: ALLOWED_ALGORITHMS,
    complete: false, // Solo retorna el payload garantizado y validado
  });
}

/**
 * Valida que los claims esenciales estén presentes y tipados correctamente en el payload.
 */
function validateClaims(payload) {
  if (!payload || typeof payload !== "object") return false;
  const hasUser = Boolean(payload.userId || payload.id || payload.sub);
  const hasRole = Boolean(payload.role);
  return hasUser && hasRole;
}

/**
 * Middleware de Autenticación Principal (requireAuth / isLoged)
 * Valida tokens JWT con firma asimétrica RS256 o claves de servicio internas autorizadas.
 */
function requireAuth(req, res, next) {
  try {
    // 1. Verificación de clave de servicio interna para llamadas entre microservicios
    const serviceApiKey = extractServiceApiKey(req);
    const configuredServiceKey =
      process.env.INTERNAL_SERVICE_API_KEY ||
      process.env.SERVICE_API_KEY ||
      config.serviceApiKey;

    if (
      configuredServiceKey &&
      serviceApiKey &&
      serviceApiKey === configuredServiceKey
    ) {
      req.user = {
        id: "internal-service",
        userId: "internal-service",
        email: "service@youconnext.internal",
        role: "admin",
        isService: true,
      };
      return next();
    }

    // 2. Extracción y verificación del token Bearer de usuario
    const token = extractBearerToken(req);
    if (!token) {
      return res.status(401).json({
        status: "Error",
        code: "UNAUTHORIZED",
        error: "Se requiere autenticación Bearer para acceder a este recurso.",
      });
    }

    let payload;
    try {
      payload = verifyStrictToken(token);
    } catch (verifyErr) {
      if (verifyErr.code === "SERVER_CONFIG_ERROR") {
        console.error("[CRITICAL] JWT_PUBLIC_KEY no está configurada");
        return res.status(500).json({
          status: "Error",
          code: "CONFIG_ERROR",
          error: "Error interno de configuración de seguridad",
        });
      }

      if (verifyErr.name === "TokenExpiredError") {
        return res.status(401).json({
          status: "Error",
          code: "TOKEN_EXPIRED",
          error: "La sesión ha expirado. Por favor, inicie sesión nuevamente.",
        });
      }

      // CRIT-01 / CRIT-02: Cualquier algoritmo inválido, "none" o firma manipulada
      return res.status(401).json({
        status: "Error",
        code: "INVALID_TOKEN",
        error: "Token de autenticación inválido o alterado.",
      });
    }

    if (!validateClaims(payload)) {
      return res.status(401).json({
        status: "Error",
        code: "INVALID_CLAIMS",
        error: "Estructura de token inválida: faltan identificadores requeridos.",
      });
    }

    const userId = String(payload.userId || payload.id || payload.sub);
    req.user = {
      id: userId,
      userId: userId,
      email: payload.email || null,
      role: payload.role || "user",
      isService: false,
    };

    return next();
  } catch (error) {
    return res.status(401).json({
      status: "Error",
      code: "AUTH_ERROR",
      error: "Error durante la validación de autenticación.",
    });
  }
}

/**
 * Middleware RBAC: Requiere que el usuario posea uno de los roles autorizados.
 *
 * @param {string|string[]} roles - Rol o array de roles permitidos (ej. ['admin', 'driver'])
 */
function requireRole(roles = []) {
  const allowed = Array.isArray(roles) ? roles : [roles];

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: "Error",
        code: "UNAUTHORIZED",
        error: "No autenticado",
      });
    }

    if (!allowed.includes(req.user.role)) {
      return res.status(403).json({
        status: "Error",
        code: "FORBIDDEN",
        error: "Acceso denegado: privilegios insuficientes para esta operación.",
      });
    }

    return next();
  };
}

/**
 * Atajo RBAC para rol administrador exclusivo (BFLA mitigation).
 */
const requireAdmin = requireRole(["admin"]);

/**
 * Middleware ABAC / Ownership Factory (HIGH-06, HIGH-07, MED-06, MED-07).
 * Previene vulnerabilidades IDOR/BOLA verificando que el usuario autenticado
 * sea el propietario del recurso solicitado o posea rol de administrador.
 *
 * @param {Function} getOwnerIdFromRequest - Función selectora que extrae el ownerId del req
 */
function requireOwnership(getOwnerIdFromRequest) {
  if (typeof getOwnerIdFromRequest !== "function") {
    throw new Error("requireOwnership requiere una función extractora como argumento");
  }

  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({
        status: "Error",
        code: "UNAUTHORIZED",
        error: "No autenticado",
      });
    }

    // Administradores o servicios internos autorizados disponen de acceso de supervisión
    if (req.user.role === "admin" || req.user.isService) {
      return next();
    }

    const targetOwnerId = String(getOwnerIdFromRequest(req) || "");
    const currentUserId = String(req.user.userId || req.user.id || "");

    if (!targetOwnerId || targetOwnerId !== currentUserId) {
      return res.status(403).json({
        status: "Error",
        code: "ACCESS_DENIED",
        error: "Acceso denegado: no tienes autorización para operar sobre recursos de otro usuario.",
      });
    }

    return next();
  };
}

module.exports = {
  ALLOWED_ALGORITHMS,
  extractBearerToken,
  verifyStrictToken,
  requireAuth,
  requireRole,
  requireAdmin,
  requireOwnership,
};
