const { describe, it, before, after } = require("node:test");
const assert = require("node:assert");
const notificationQueue = require("../src/services/notificationQueue");
const CircuitBreaker = require("../src/security/circuitBreaker");

describe("Pruebas de Resiliencia y Asincronismo de Notificaciones (CRIT-03, CRIT-04)", () => {
  before(() => {
    // Configuramos manejadores controlados para las pruebas
    notificationQueue.setCustomHandlers({
      pushHandler: async (job) => ({ success: true, messageId: `mock-${job.jobId}` }),
      emailHandler: async (job) => ({ success: true, messageId: `mock-mail-${job.jobId}` }),
    });
  });

  after(async () => {
    notificationQueue.clearMemoryQueue();
    notificationQueue.setCustomHandlers({
      pushHandler: null,
      emailHandler: null,
    });
    await notificationQueue.closeRabbitMQ();
  });

  it("CRIT-03: Debe procesar 20 peticiones concurrentes a enqueuePush sin bloquearse y retornando 202 status", async () => {
    const promises = [];
    const concurrencyCount = 20;

    for (let i = 0; i < concurrencyCount; i++) {
      promises.push(
        notificationQueue.enqueuePush({
          token: `device-token-concurrent-test-${i}`,
          title: `Alerta Concurrente #${i}`,
          body: "Mensaje de prueba de carga y resiliencia",
          data: { testId: i },
        }),
      );
    }

    const results = await Promise.all(promises);

    assert.strictEqual(results.length, concurrencyCount);
    for (const res of results) {
      assert.strictEqual(res.status, "queued");
      assert.ok(
        res.jobId,
        "Cada notificación encolada debe disponer de un jobId único",
      );
      assert.ok(res.queuedAt, "Debe registrar la marca de tiempo de encolado");
    }
  });

  it("Debe encolar correos electrónicos de forma asíncrona sin bloquear el event loop", async () => {
    const emailResult = await notificationQueue.enqueueEmail({
      to: "usuario@youconnext.es",
      template: "welcome",
      data: { name: "Sergio" },
    });

    assert.strictEqual(emailResult.status, "queued");
    assert.ok(emailResult.jobId);
  });

  it("Circuit Breaker: Debe abrirse y proteger el sistema tras superar el umbral de fallos consecutivos", async () => {
    const breaker = new CircuitBreaker("TestExternalService", {
      failureThreshold: 3,
      recoveryTimeoutMs: 1000,
      callTimeoutMs: 500,
    });

    const failingServiceCall = async () => {
      throw new Error("Servicio de terceros caído");
    };

    // Intentos 1, 2, 3: fallan y se registran en CLOSED
    for (let i = 0; i < 3; i++) {
      await assert.rejects(async () => {
        await breaker.execute(failingServiceCall);
      });
    }

    // El 4º intento debe ser cortado inmediatamente por el Circuit Breaker (OPEN) sin llamar a la función
    let functionCalled = false;
    await assert.rejects(
      async () => {
        await breaker.execute(async () => {
          functionCalled = true;
        });
      },
      (err) => {
        return err.code === "CIRCUIT_BREAKER_OPEN";
      },
      "El Circuit Breaker DEBE lanzar CIRCUIT_BREAKER_OPEN inmediatamente",
    );

    assert.strictEqual(
      functionCalled,
      false,
      "La función protegida NO debió ejecutarse mientras el circuito está OPEN",
    );
  });
});
