const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const templateService = require("../src/services/templateService");
const pushTemplateService = require("../src/services/pushTemplateService");

describe("Pruebas de Caché de Plantillas, Escape HTML y Plantilla trip_alert_matched", () => {
  let originalReadFileSync;

  beforeEach(() => {
    templateService.clearTemplateCache();
    originalReadFileSync = fs.readFileSync;
  });

  afterEach(() => {
    fs.readFileSync = originalReadFileSync;
    templateService.clearTemplateCache();
  });

  it("Debe cachear la plantilla HTML en memoria y evitar lecturas repetidas de disco", () => {
    let diskReadCount = 0;
    fs.readFileSync = (...args) => {
      diskReadCount += 1;
      return originalReadFileSync.apply(fs, args);
    };

    const payload = {
      tripId: "trip-10",
      origin: "Madrid",
      destination: "Valencia",
      date: "15/11/2026",
      time: "08:30",
      price: "18 €",
      seats: 3,
      driverName: "Carlos",
      frontendUrl: "https://app.youconnext.es",
    };

    const first = templateService.renderTemplate("trip_alert_matched", payload);
    const second = templateService.renderTemplate("trip_alert_matched", payload);
    const third = templateService.renderTemplate("trip_alert_matched", payload);

    assert.strictEqual(diskReadCount, 1, "Solo debe leer del disco en el primer render");
    assert.strictEqual(first.html, second.html);
    assert.strictEqual(second.html, third.html);
    assert.ok(first.html.includes("Madrid"));
    assert.ok(first.html.includes("Valencia"));
    assert.ok(first.html.includes("https://app.youconnext.es/trips/trip-10"));
  });

  it("Debe escapar etiquetas HTML peligrosas en variables interpoladas sin alterar el asunto", () => {
    const rendered = templateService.renderTemplate("trip_alert_matched", {
      tripId: "trip-99",
      origin: "Sevilla",
      destination: "Granada & Córdoba",
      date: "20/11/2026",
      time: "10:00",
      price: "12 €",
      driverName: '<script>alert("xss")</script>',
      userName: "<b>Ana</b>",
    });

    assert.ok(!rendered.html.includes("<script>"), "No debe permitir etiquetas <script> sin escapar");
    assert.ok(rendered.html.includes("&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;"));
    assert.ok(rendered.html.includes("Granada &amp; Córdoba"));
    assert.ok(rendered.subject.includes("Granada & Córdoba"), "El asunto plano no debe llevar entidades HTML");
  });

  it("Debe renderizar trip_alert_matched con y sin userName sin dejar placeholders {{...}}", () => {
    const withoutName = templateService.renderTemplate("trip_alert_matched", {
      tripId: "trip-1",
      origin: "Bilbao",
      destination: "San Sebastián",
      date: "18/11/2026",
      time: "09:00",
      price: "10 €",
      seats: 2,
      driverName: "Lucía",
    });

    assert.ok(withoutName.html.includes("¡Hola!"));
    assert.ok(!/\{\{.*?\}\}/.test(withoutName.html), "No deben quedar placeholders sin resolver");

    const withName = templateService.renderTemplate("trip_alert_matched", {
      tripId: "trip-1",
      origin: "Bilbao",
      destination: "San Sebastián",
      date: "18/11/2026",
      time: "09:00",
      price: "10 €",
      userName: "Sergio",
    });

    assert.ok(withName.html.includes("¡Hola, Sergio!"));
  });

  it("Debe renderizar la plantilla Push trip_alert_matched con mensaje genérico apto para multicast", () => {
    const pushPayload = pushTemplateService.renderPushTemplate("trip_alert_matched", {
      tripId: "trip-555",
      origin: "Madrid",
      destination: "Valencia",
      date: "15/11/2026",
      time: "08:30",
      price: "18 €",
    });

    assert.strictEqual(pushPayload.title, "¡Nuevo viaje Madrid → Valencia! 🚗");
    assert.ok(pushPayload.body.includes("15/11/2026"));
    assert.ok(pushPayload.body.includes("18 €"));
    assert.deepStrictEqual(pushPayload.data, {
      type: "trip_alert_matched",
      tripId: "trip-555",
    });
  });
});
