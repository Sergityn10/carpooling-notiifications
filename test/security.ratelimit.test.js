const { describe, it } = require("node:test");
const assert = require("node:assert");
const { createRateLimiter } = require("../src/security");

describe("Pruebas de Rate Limiting y Control de Flujo (ALTO-13, MED-23)", () => {
  it("Debe bloquear peticiones y retornar HTTP 429 con cabecera Retry-After al exceder el umbral", async () => {
    // Creamos un rate limiter con max: 3 peticiones por ventana de 10s
    const limiter = createRateLimiter({
      windowMs: 10000,
      max: 3,
      message: "Límite excedido",
      keyGenerator: () => "test-client-ip",
    });

    const headersSent = {};
    let statusReturned = 0;
    let jsonBody = null;

    const createMockRes = () => ({
      setHeader: (k, v) => {
        headersSent[k] = v;
      },
      getHeader: (k) => headersSent[k],
      status: (code) => {
        statusReturned = code;
        return {
          json: (body) => {
            jsonBody = body;
          },
        };
      },
    });

    const req = { headers: {}, ip: "127.0.0.1" };

    // Petición 1: Permitida
    await new Promise((resolve) => limiter(req, createMockRes(), resolve));
    // Petición 2: Permitida
    await new Promise((resolve) => limiter(req, createMockRes(), resolve));
    // Petición 3: Permitida
    await new Promise((resolve) => limiter(req, createMockRes(), resolve));

    // Petición 4: Debe disparar 429 Too Many Requests
    let nextCalledOnFourth = false;
    await new Promise((resolve) => {
      const res = createMockRes();
      limiter(req, res, () => {
        nextCalledOnFourth = true;
        resolve();
      });
      // El handler llama a res.status().json()
      setTimeout(resolve, 50);
    });

    assert.strictEqual(nextCalledOnFourth, false, "La 4ª petición NO debe llamar a next()");
    assert.strictEqual(statusReturned, 429, "Debe retornar código 429");
    assert.ok(headersSent["Retry-After"], "Debe incluir cabecera Retry-After");
    assert.strictEqual(jsonBody.code, "TOO_MANY_REQUESTS");
  });
});
