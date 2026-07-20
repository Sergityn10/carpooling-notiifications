const jwt = require("jsonwebtoken");

const JWT_ALGORITHM = process.env.JWT_ALGORITHM || "RS256";
const PUBLIC_KEY = (process.env.JWT_PUBLIC_KEY || "").replace(/\\n/g, "\n");

function getBearerToken(req) {
  const rawHeader = req.headers.authorization || req.headers.authentication;
  if (!rawHeader || typeof rawHeader !== "string") return null;

  const [scheme, token] = rawHeader.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") return null;

  return token;
}

function validatePayload(payload) {
  return payload && payload.userId && payload.email && payload.role;
}

function requireAdmin(req, res, next) {
  if (!req.user || req.user.role !== "admin") {
    return res
      .status(403)
      .json({ error: "Acceso denegado: se requiere rol de administrador" });
  }
  next();
}

function requireAuth(req, res, next) {
  try {
    if (!PUBLIC_KEY) {
      return res
        .status(500)
        .json({ error: "JWT_PUBLIC_KEY no está configurada" });
    }

    const token = getBearerToken(req);
    if (!token) {
      console.log(req.body);
      return res.status(401).json({ error: "Token Bearer requerido" });
    }

    const payload = jwt.verify(token, PUBLIC_KEY, {
      algorithms: [JWT_ALGORITHM],
    });
    if (!validatePayload(payload)) {
      return res
        .status(401)
        .json({ error: "Token inválido: faltan userId, email o role" });
    }

    req.user = {
      userId: String(payload.userId),
      email: payload.email,
      role: payload.role,
    };

    next();
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expirado" });
    }

    return res
      .status(401)
      .json({ error: "Token inválido", detail: error.message });
  }
}

module.exports = { requireAuth, requireAdmin };
