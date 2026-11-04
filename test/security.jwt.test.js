const { describe, it, before } = require("node:test");
const assert = require("node:assert");
const crypto = require("node:crypto");
const jwt = require("jsonwebtoken");

// Importamos el módulo de seguridad a testear
const {
  verifyStrictToken,
  requireAuth,
  requireRole,
  requireOwnership,
  ALLOWED_ALGORITHMS,
} = require("../src/security");

describe("Pruebas de Blindaje Criptográfico JWT (CRIT-01, CRIT-02)", () => {
  let rsaPrivateKey;
  let rsaPublicKey;

  before(() => {
    // Generamos un par de claves RSA legítimo para la suite de pruebas
    const keyPair = crypto.generateKeyPairSync("rsa", {
      modulusLength: 2048,
      publicKeyEncoding: { type: "spki", format: "pem" },
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
    });
    rsaPrivateKey = keyPair.privateKey;
    rsaPublicKey = keyPair.publicKey;

    // Configuramos temporalmente la clave pública para el entorno de test
    process.env.JWT_PUBLIC_KEY = rsaPublicKey;
  });

  it("CRIT-01: Debe rechazar taxativamente tokens con algoritmo 'none'", () => {
    // Construcción manual de un token con cabecera {"alg": "none"}
    const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ userId: "hacker-123", email: "hacker@evil.com", role: "admin" })).toString("base64url");
    const noneToken = `${header}.${payload}.`;

    assert.throws(
      () => {
        verifyStrictToken(noneToken);
      },
      (err) => {
        return (
          err.name === "JsonWebTokenError" ||
          err.message.includes("algorithm") ||
          err.message.includes("invalid")
        );
      },
      "Un token con alg: none DEBE ser rechazado de inmediato",
    );
  });

  it("CRIT-01: Debe rechazar tokens firmados con algoritmos simétricos (HS256) usando la clave pública como secreto", () => {
    // Ataque clásico de confusión de algoritmo: firmar con HS256 usando el texto de la clave pública
    const symmetricToken = jwt.sign(
      { userId: "attacker", email: "attacker@test.com", role: "admin" },
      rsaPublicKey,
      { algorithm: "HS256" },
    );

    assert.throws(
      () => {
        verifyStrictToken(symmetricToken);
      },
      (err) => {
        return (
          err.name === "JsonWebTokenError" ||
          err.message.includes("algorithm") ||
          err.message.includes("invalid")
        );
      },
      "Un token con algoritmo HS256 cruzado DEBE ser rechazado",
    );
  });

  it("CRIT-02: Debe rechazar tokens con userId manipulado o firma adulterada", () => {
    const validToken = jwt.sign(
      { userId: "100", email: "user100@youconnext.es", role: "user" },
      rsaPrivateKey,
      { algorithm: "RS256" },
    );

    // Manipulamos el payload alterando userId a 999 (suplantación de identidad)
    const parts = validToken.split(".");
    const maliciousPayload = Buffer.from(
      JSON.stringify({ userId: "999", email: "admin@youconnext.es", role: "admin" }),
    ).toString("base64url");
    const tamperedToken = `${parts[0]}.${maliciousPayload}.${parts[2]}`;

    assert.throws(
      () => {
        verifyStrictToken(tamperedToken);
      },
      (err) => {
        return (
          err.name === "JsonWebTokenError" ||
          err.message.includes("signature") ||
          err.message.includes("invalid")
        );
      },
      "Un token con payload alterado DEBE ser rechazado por firma inválida",
    );
  });

  it("Debe verificar y aceptar con éxito un token legítimo firmado con RS256", () => {
    const token = jwt.sign(
      { userId: "user-42", email: "sergio@youconnext.es", role: "driver" },
      rsaPrivateKey,
      { algorithm: "RS256", expiresIn: "1h" },
    );

    const decoded = verifyStrictToken(token);
    assert.strictEqual(decoded.userId, "user-42");
    assert.strictEqual(decoded.email, "sergio@youconnext.es");
    assert.strictEqual(decoded.role, "driver");
  });

  it("Middleware requireAuth: debe rechazar peticiones sin cabecera Authorization", () => {
    const req = { headers: {} };
    let responseStatus = 0;
    let responseBody = null;
    const res = {
      status: (code) => {
        responseStatus = code;
        return {
          json: (body) => {
            responseBody = body;
          },
        };
      },
    };

    let nextCalled = false;
    requireAuth(req, res, () => {
      nextCalled = true;
    });

    assert.strictEqual(nextCalled, false);
    assert.strictEqual(responseStatus, 401);
    assert.strictEqual(responseBody.code, "UNAUTHORIZED");
  });

  it("Middleware requireRole: debe permitir acceso a roles válidos y denegar a roles no autorizados", () => {
    const adminReq = { user: { id: "1", role: "admin" } };
    const userReq = { user: { id: "2", role: "user" } };

    let adminPassed = false;
    const adminMiddleware = requireRole(["admin"]);
    adminMiddleware(adminReq, {}, () => {
      adminPassed = true;
    });
    assert.strictEqual(adminPassed, true);

    let deniedStatus = 0;
    const mockRes = {
      status: (code) => {
        deniedStatus = code;
        return { json: () => {} };
      },
    };
    adminMiddleware(userReq, mockRes, () => {});
    assert.strictEqual(deniedStatus, 403);
  });

  it("Middleware requireOwnership: previene IDOR permitiendo solo al dueño o al admin", () => {
    const ownershipMiddleware = requireOwnership((req) => req.params.userId);

    // 1. Dueño legítimo
    const ownerReq = { user: { id: "user-5", userId: "user-5", role: "user" }, params: { userId: "user-5" } };
    let ownerPassed = false;
    ownershipMiddleware(ownerReq, {}, () => {
      ownerPassed = true;
    });
    assert.strictEqual(ownerPassed, true);

    // 2. Administrador con privilegio de supervisión
    const adminReq = { user: { id: "admin-1", userId: "admin-1", role: "admin" }, params: { userId: "user-5" } };
    let adminPassed = false;
    ownershipMiddleware(adminReq, {}, () => {
      adminPassed = true;
    });
    assert.strictEqual(adminPassed, true);

    // 3. Atacante intentando acceder a recursos de otro usuario (IDOR)
    const attackerReq = { user: { id: "attacker", userId: "attacker", role: "user" }, params: { userId: "user-5" } };
    let deniedStatus = 0;
    const mockRes = {
      status: (code) => {
        deniedStatus = code;
        return { json: () => {} };
      },
    };
    ownershipMiddleware(attackerReq, mockRes, () => {});
    assert.strictEqual(deniedStatus, 403);
  });
});
