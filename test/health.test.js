const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const http = require("node:http");
const app = require("../src/server");

describe("Pruebas de Health Checks y Supervisión de Procesos (CRIT-04)", () => {
  let server;
  let baseUrl;

  before(async () => {
    await new Promise((resolve) => {
      server = app.listen(0, () => {
        const port = server.address().port;
        baseUrl = `http://127.0.0.1:${port}`;
        resolve();
      });
    });
  });

  after(async () => {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  function httpGet(path) {
    return new Promise((resolve, reject) => {
      http.get(`${baseUrl}${path}`, (res) => {
        let rawData = "";
        res.on("data", (chunk) => {
          rawData += chunk;
        });
        res.on("end", () => {
          try {
            const parsed = JSON.parse(rawData);
            resolve({ statusCode: res.statusCode, body: parsed });
          } catch {
            resolve({ statusCode: res.statusCode, body: rawData });
          }
        });
      }).on("error", reject);
    });
  }

  it("Debe responder en /health con 200 OK y estado operativo", async () => {
    const res = await httpGet("/health");

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, "ok");
    assert.strictEqual(res.body.service, "carpooling-notifications");
    assert.ok(typeof res.body.uptimeSeconds === "number");
  });

  it("Debe responder en /health/liveness con 200 OK para probes de Kubernetes/Docker", async () => {
    const res = await httpGet("/health/liveness");

    assert.strictEqual(res.statusCode, 200);
    assert.strictEqual(res.body.status, "healthy");
    assert.strictEqual(res.body.check, "liveness");
  });
});
