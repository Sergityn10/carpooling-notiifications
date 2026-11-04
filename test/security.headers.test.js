const { describe, it } = require("node:test");
const assert = require("node:assert");
const { helmetMiddleware, obfuscateBanners } = require("../src/security");

describe("Pruebas de Cabeceras de Seguridad y Hardening HTTP (LOW-01, MED-01)", () => {
  it("Debe aplicar HSTS, CSP, nosniff, frameguard DENY y ocultar X-Powered-By", async () => {
    const headers = {};
    const mockReq = { method: "GET", url: "/test-headers", headers: {} };
    const mockRes = {
      setHeader: (name, value) => {
        headers[name.toLowerCase()] = value;
      },
      getHeader: (name) => headers[name.toLowerCase()],
      removeHeader: (name) => {
        delete headers[name.toLowerCase()];
      },
      send: () => {},
    };

    // Simulamos cabeceras iniciales vulnerables
    mockRes.setHeader("x-powered-by", "Express");
    mockRes.setHeader("server", "nginx/1.28.3");

    // 1. Ejecución de Helmet
    await new Promise((resolve) => {
      helmetMiddleware(mockReq, mockRes, () => resolve());
    });

    // 2. Ejecución de ofuscador de banners
    await new Promise((resolve) => {
      obfuscateBanners(mockReq, mockRes, () => resolve());
    });

    // Verificaciones DAST:
    // 1. MED-01: Strict-Transport-Security (HSTS con max-age=31536000, subdominios y preload)
    const hsts = headers["strict-transport-security"];
    assert.ok(hsts, "Cabecera HSTS debe estar presente");
    assert.ok(
      hsts.includes("max-age=31536000"),
      "HSTS debe durar 1 año (31536000 s)",
    );
    assert.ok(hsts.includes("includeSubDomains"), "HSTS debe incluir subdominios");
    assert.ok(hsts.includes("preload"), "HSTS debe incluir preload");

    // 2. LOW-01: X-Content-Type-Options: nosniff
    assert.strictEqual(
      headers["x-content-type-options"],
      "nosniff",
      "Debe existir X-Content-Type-Options: nosniff",
    );

    // 3. LOW-02: X-Frame-Options: DENY
    assert.strictEqual(
      headers["x-frame-options"],
      "DENY",
      "Debe existir X-Frame-Options: DENY",
    );

    // 4. LOW-03: Content-Security-Policy
    assert.ok(
      headers["content-security-policy"],
      "Debe existir Content-Security-Policy",
    );

    // 5. LOW-04 / Banners: X-Powered-By y Server NO deben estar presentes
    assert.strictEqual(
      headers["x-powered-by"],
      undefined,
      "X-Powered-By NO debe ser expuesto",
    );
    assert.strictEqual(
      headers["server"],
      undefined,
      "Server header NO debe ser expuesto",
    );
  });
});
