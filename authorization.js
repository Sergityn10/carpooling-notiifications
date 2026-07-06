import jsonwebtoken from "jsonwebtoken";
import dotenv from "dotenv";
import crypto from "crypto";
import prisma from "../lib/prisma.js";
import { methods as cryptoUtils } from "../utils/crypto.js";
import { PRIVATE_KEY, PUBLIC_KEY, JWT_ALGORITHM } from "../utils/jwtKeys.js";
dotenv.config();

const ONE_MONTH_MS = 30 * 24 * 60 * 60 * 1000;
const ACCESS_COOKIE_MINUTES = Number(
  process.env.JWT_COOKIES_EXPIRATION_TIME || 15,
);
const PROACTIVE_REFRESH_MS = 5 * 60 * 1000; // Refresh access token if it expires within 5 min
const isProduction = process.env.NODE_ENV === "production";

function buildCookieOptions(expiresAt, { httpOnly = true } = {}) {
  const maxAge = expiresAt.getTime() - Date.now();
  return {
    httpOnly,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
    expires: expiresAt,
    maxAge,
  };
}

function buildAccessCookieOptions() {
  const expiresAt = new Date(Date.now() + ACCESS_COOKIE_MINUTES * 60 * 1000);
  return buildCookieOptions(expiresAt);
}

async function persistRefreshToken(
  userId,
  rawToken,
  expiresAt,
  { deleteAll = true, oldTokenHash = null } = {},
) {
  const hashedToken = crypto
    .createHash("sha256")
    .update(rawToken)
    .digest("hex");

  if (deleteAll) {
    await prisma.refreshToken.deleteMany({ where: { user_id: userId } });
  } else if (oldTokenHash) {
    await prisma.refreshToken.deleteMany({
      where: { user_id: userId, token: oldTokenHash },
    });
  }

  await prisma.refreshToken.create({
    data: {
      user_id: userId,
      token: hashedToken,
      expires_at: expiresAt,
      revoked: false,
    },
  });

  return hashedToken;
}

async function issueRefreshToken(
  res,
  userId,
  { rotate = false, oldTokenHash = null } = {},
) {
  const rawToken = crypto.randomBytes(40).toString("hex");
  const expiresAt = new Date(Date.now() + ONE_MONTH_MS);

  await persistRefreshToken(userId, rawToken, expiresAt, {
    deleteAll: !rotate,
    oldTokenHash: rotate ? oldTokenHash : null,
  });
  res.cookie("refresh_token", rawToken, buildCookieOptions(expiresAt));
}

function clearRefreshCookie(res) {
  if (res?.clearCookie) {
    res.clearCookie("refresh_token", {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? "none" : "lax",
      path: "/",
    });
  }
}

async function tryRefreshAccessToken(req, res) {
  try {
    const rawRefreshToken = req?.cookies?.refresh_token;
    if (!rawRefreshToken) return null;

    const hashedRefresh = crypto
      .createHash("sha256")
      .update(rawRefreshToken)
      .digest("hex");

    const stored = await prisma.refreshToken.findFirst({
      where: { token: hashedRefresh, revoked: false },
      select: { id: true, user_id: true, expires_at: true, revoked: true },
    });

    if (!stored) {
      clearRefreshCookie(res);
      return null;
    }

    const expiresAt = new Date(stored.expires_at);
    if (
      Number.isNaN(expiresAt.getTime()) ||
      expiresAt.getTime() <= Date.now()
    ) {
      clearRefreshCookie(res);
      return null;
    }

    const user = await prisma.user.findUnique({
      where: { id: stored.user_id },
      include: { role: true },
    });

    if (!user) {
      clearRefreshCookie(res);
      return null;
    }

    const accessToken = jsonwebtoken.sign(
      { userId: user.id, email: user.email, role: user.role?.name ?? "user" },
      PRIVATE_KEY,
      { expiresIn: process.env.EXPIRATION_TIME, algorithm: JWT_ALGORITHM },
    );

    if (res?.cookie) {
      res.cookie("access_token", accessToken, buildAccessCookieOptions());
    }

    // Rotate refresh token: only delete the old one, not all tokens
    await issueRefreshToken(res, user.id, {
      rotate: true,
      oldTokenHash: hashedRefresh,
    });

    return cryptoUtils.decryptFields(user, cryptoUtils.USER_SENSITIVE_FIELDS);
  } catch (error) {
    console.error("Error in tryRefreshAccessToken:", error);
    return null;
  }
}

function send401(res, message = "Token inválido o expirado.") {
  res.clearCookie("access_token", {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? "none" : "lax",
    path: "/",
  });
  return res.status(401).send({ status: "Error", message });
}

function shouldProactivelyRefresh(decoded) {
  if (!decoded?.exp) return false;
  const expiresAtMs = decoded.exp * 1000;
  const nowMs = Date.now();
  return expiresAtMs - nowMs <= PROACTIVE_REFRESH_MS;
}

async function silentlyRefreshAccessToken(req, res, user) {
  try {
    const rawRefreshToken = req?.cookies?.refresh_token;
    if (!rawRefreshToken) return;

    const hashedRefresh = crypto
      .createHash("sha256")
      .update(rawRefreshToken)
      .digest("hex");

    const exists = await prisma.refreshToken.findFirst({
      where: { token: hashedRefresh, revoked: false },
      select: { id: true },
    });
    if (!exists) return;

    const accessToken = jsonwebtoken.sign(
      { userId: user.id, email: user.email, role: user.role?.name ?? "user" },
      PRIVATE_KEY,
      { expiresIn: process.env.EXPIRATION_TIME, algorithm: JWT_ALGORITHM },
    );

    if (res?.cookie) {
      res.cookie("access_token", accessToken, buildAccessCookieOptions());
    }
  } catch (_e) {
    // Silent failure — don't interrupt the request
  }
}

async function authenticate(req, res) {
  let user;
  let expired = false;
  let decoded = null;
  try {
    user = (await reviseBearer(req)) || (await reviseCookie(req));
  } catch (e) {
    if (e.isExpired) {
      expired = true;
    } else {
      return {
        user: null,
        error: send401(res, `Token inválido: ${e.message}`),
      };
    }
  }

  if (!user && expired) {
    user = await tryRefreshAccessToken(req, res);
  }

  if (!user) {
    return { user: null, error: send401(res, "Token inválido o expirado.") };
  }

  // Proactive refresh: if the access token is valid but expires soon,
  // silently issue a new one so the client doesn't get 401 on the next request.
  if (!expired) {
    decoded = getDecodedToken(req);
    if (decoded && shouldProactivelyRefresh(decoded)) {
      await silentlyRefreshAccessToken(req, res, user);
    }
  }

  return { user, error: null };
}

async function isLoged(req, res, next) {
  const { user, error } = await authenticate(req, res);
  if (error) return error;
  req.user = user;
  next();
}

async function onlyAdmin(req, res, next) {
  const { user, error } = await authenticate(req, res);
  if (error) return error;
  if (user.role.name === "admin") {
    req.user = user;
    next();
  } else {
    return res
      .status(403)
      .send({ status: "Error", message: "Access denied. Admins only." });
  }
}

async function onlyUser(req, res, next) {
  const { user, error } = await authenticate(req, res);
  if (error) return error;
  if (user.role.name === "user") {
    req.user = user;
    next();
  } else {
    return res
      .status(403)
      .send({ status: "Error", message: "Access denied. Users only." });
  }
}

function getBearerTokenFromReq(req) {
  const rawHeader = req?.headers?.authorization || req?.headers?.authentication;
  if (!rawHeader || typeof rawHeader !== "string") {
    return null;
  }
  console.log(rawHeader);

  const [scheme, token] = rawHeader.split(" ");
  if (!scheme || !token) {
    return null;
  }

  if (scheme.toLowerCase() !== "bearer") {
    return null;
  }

  return token;
}

function isValidJwtFormat(token) {
  const jwtPattern = /^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/;
  return (
    typeof token === "string" && jwtPattern.test(token) && token.length > 100
  );
}

function getDecodedToken(req) {
  const bearerToken = getBearerTokenFromReq(req);
  const cookieToken = req?.cookies?.access_token;
  const token = bearerToken || cookieToken;
  if (!token || !isValidJwtFormat(token)) return null;
  try {
    return jsonwebtoken.decode(token);
  } catch (_e) {
    return null;
  }
}

async function reviseBearer(req) {
  try {
    const bearerToken = getBearerTokenFromReq(req);
    if (!bearerToken) {
      return false;
    }

    // Add format validation
    if (!isValidJwtFormat(bearerToken)) {
      console.error(
        "Invalid JWT format in Bearer token:",
        bearerToken?.substring(0, 20) + "...",
      );
      return false;
    }

    const decodificado = jsonwebtoken.verify(bearerToken, PUBLIC_KEY, {
      algorithms: [JWT_ALGORITHM],
    });

    const hasUserId =
      decodificado?.userId !== undefined && decodificado?.userId !== null;
    console.log(decodificado);

    const findUser = await prisma.user.findFirst({
      where: hasUserId
        ? { id: String(decodificado.userId) }
        : { email: decodificado.email },
      include: { role: true },
    });

    if (!findUser) {
      return false;
    }
    return cryptoUtils.decryptFields(
      findUser,
      cryptoUtils.USER_SENSITIVE_FIELDS,
    );
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      const expiredError = new Error("Token expired");
      expiredError.isExpired = true;
      throw expiredError;
    }
    console.error("Error al verificar el bearer token:", error);
    return false;
  }
}

async function reviseCookie(req) {
  try {
    const cookieJWT = req.cookies.access_token;

    if (!cookieJWT) {
      return false;
    }
    console.log(cookieJWT);

    // Add format validation
    if (!isValidJwtFormat(cookieJWT)) {
      console.error(
        "Invalid JWT format in Cookie token:",
        cookieJWT?.substring(0, 20) + "...",
      );
      return false;
    }

    const decodificado = jsonwebtoken.verify(cookieJWT, PUBLIC_KEY, {
      algorithms: [JWT_ALGORITHM],
    });
    console.log(decodificado);

    const hasUserId =
      decodificado?.userId !== undefined && decodificado?.userId !== null;

    const findUser = await prisma.user.findFirst({
      where: hasUserId
        ? { id: String(decodificado.userId) }
        : { email: decodificado.email },
      include: { role: true },
    });

    if (!findUser) {
      if (typeof req?.res?.clearCookie === "function") {
        req.res.clearCookie("access_token", {
          httpOnly: true,
          secure: true,
          sameSite: "none",
          path: "/",
          domain: process.env.ORIGIN,
        });
      }
      return false;
    }
    return cryptoUtils.decryptFields(
      findUser,
      cryptoUtils.USER_SENSITIVE_FIELDS,
    );
  } catch (error) {
    if (error.name === "TokenExpiredError") {
      const expiredError = new Error("Token expired");
      expiredError.isExpired = true;
      throw expiredError;
    }
    console.error("Error al verificar la cookie:", error);
    return false;
  }
}

export {
  buildCookieOptions,
  buildAccessCookieOptions,
  issueRefreshToken,
  persistRefreshToken,
};

export const authorization = {
  isLoged,
  reviseBearer,
  reviseCookie,
  onlyAdmin,
  onlyUser,
  tryRefreshAccessToken,
};
