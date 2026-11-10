const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const prisma = require("../src/lib/prisma");
const deviceTokenService = require("../src/services/deviceTokenService");

describe("Pruebas de Resolución Bulk y Limpieza de Device Tokens", () => {
  let originalFindMany;
  let originalUpdateMany;

  beforeEach(() => {
    originalFindMany = prisma.userDeviceToken.findMany;
    originalUpdateMany = prisma.userDeviceToken.updateMany;
  });

  afterEach(() => {
    prisma.userDeviceToken.findMany = originalFindMany;
    prisma.userDeviceToken.updateMany = originalUpdateMany;
  });

  it("deactivateDeviceToken(null, token) debe filtrar solo por token sin pasar userId: null a Prisma", async () => {
    let capturedArgs = null;
    prisma.userDeviceToken.updateMany = async (args) => {
      capturedArgs = args;
      return { count: 1 };
    };

    const result = await deviceTokenService.deactivateDeviceToken(null, "fcm-obsolete-1");

    assert.strictEqual(result, true);
    assert.deepStrictEqual(capturedArgs, {
      where: { token: "fcm-obsolete-1" },
      data: { active: false },
    });
  });

  it("deactivateTokensBulk debe deduplicar y desactivar tokens obsoletos en una sola query por bloque", async () => {
    const calls = [];
    prisma.userDeviceToken.updateMany = async (args) => {
      calls.push(args);
      return { count: args.where.token.in.length };
    };

    const count = await deviceTokenService.deactivateTokensBulk([
      "tok-1",
      "tok-2",
      "tok-1",
      "",
      null,
      "tok-3",
    ]);

    assert.strictEqual(count, 3);
    assert.strictEqual(calls.length, 1);
    assert.deepStrictEqual(calls[0], {
      where: {
        token: { in: ["tok-1", "tok-2", "tok-3"] },
        active: true,
      },
      data: { active: false },
    });
  });

  it("getActiveTokensByUserIds debe consultar en bloques de 1000 y deduplicar tokens", async () => {
    const queryChunks = [];
    prisma.userDeviceToken.findMany = async (args) => {
      queryChunks.push(args.where.userId.in);
      return args.where.userId.in.map((id, idx) => ({
        userId: id,
        // Forzamos un token compartido para comprobar deduplicación
        token: idx === 0 ? "shared-token" : `token-${id}`,
      }));
    };

    const userIds = Array.from({ length: 1200 }, (_, i) => `user-${i}`);
    const result = await deviceTokenService.getActiveTokensByUserIds(userIds);

    assert.strictEqual(queryChunks.length, 2, "1200 userIds deben dividirse en 2 consultas (1000 + 200)");
    assert.strictEqual(queryChunks[0].length, 1000);
    assert.strictEqual(queryChunks[1].length, 200);
    // En ambos chunks el índice 0 genera "shared-token", así que 1200 - 1 = 1199 únicos
    assert.strictEqual(result.tokens.length, 1199);
    assert.strictEqual(result.tokensByUser.size, 1200);
  });
});
