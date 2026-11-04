const { describe, it, beforeEach, afterEach } = require("node:test");
const assert = require("node:assert");
const emailService = require("../src/services/emailService");
const templateService = require("../src/services/templateService");
const enterpriseEventHandler = require("../src/handlers/enterpriseEventHandler");
const rabbitmqConsumer = require("../src/services/rabbitmqConsumer");

describe("Pruebas del Manejador de Notificaciones de Empresa (enterpriseEventHandler)", () => {
  let originalSendEmail;
  let sentEmails = [];

  beforeEach(() => {
    sentEmails = [];
    originalSendEmail = emailService.sendEmail;
    // Interceptar llamadas a sendEmail para verificar parámetros
    emailService.sendEmail = async (mailOptions) => {
      sentEmails.push(mailOptions);
      return {
        messageId: "mock-message-id",
        accepted: [mailOptions.to],
        rejected: [],
      };
    };
  });

  afterEach(() => {
    emailService.sendEmail = originalSendEmail;
    sentEmails = [];
  });

  describe("Mapeo de roles de empresa (getRoleTitle)", () => {
    it("Debe mapear ADMIN a 'Administrador de Organización'", () => {
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("ADMIN"),
        "Administrador de Organización",
      );
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("admin"),
        "Administrador de Organización",
      );
    });

    it("Debe mapear MANAGER a 'Gestor de Movilidad'", () => {
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("MANAGER"),
        "Gestor de Movilidad",
      );
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("manager"),
        "Gestor de Movilidad",
      );
    });

    it("Debe mapear EMPLOYEE a 'Empleado'", () => {
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("EMPLOYEE"),
        "Empleado",
      );
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("employee"),
        "Empleado",
      );
    });

    it("Debe retornar 'Empleado' por defecto ante roles nulos o no reconocidos", () => {
      assert.strictEqual(enterpriseEventHandler.getRoleTitle(null), "Empleado");
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle(undefined),
        "Empleado",
      );
      assert.strictEqual(
        enterpriseEventHandler.getRoleTitle("UNKNOWN_ROLE"),
        "Empleado",
      );
    });
  });

  describe("Formateo de fechas de caducidad (formatExpirationDate)", () => {
    it("Debe formatear una fecha válida en español (es-ES)", () => {
      const isoDate = "2026-11-06T12:00:00.000Z";
      const formatted = enterpriseEventHandler.formatExpirationDate(isoDate);

      // Verificamos que incluya día, mes en español y año
      assert.ok(formatted.includes("2026"), "Debe contener el año 2026");
      assert.ok(
        formatted.includes("noviembre"),
        "Debe contener el mes en español",
      );
    });

    it("Debe retornar '7 días naturales' si la fecha es nula, vacía o inválida", () => {
      assert.strictEqual(
        enterpriseEventHandler.formatExpirationDate(null),
        "7 días naturales",
      );
      assert.strictEqual(
        enterpriseEventHandler.formatExpirationDate(""),
        "7 días naturales",
      );
      assert.strictEqual(
        enterpriseEventHandler.formatExpirationDate("fecha-invalida"),
        "7 días naturales",
      );
    });
  });

  describe("Renderizado e interpolación de la plantilla (templateService)", () => {
    it("Debe compilar la plantilla enterprise_invitation con todas sus variables", () => {
      const templateData = {
        enterpriseName: "Acme Mobility Corp",
        recipientEmail: "empleado@acme.com",
        roleTitle: "Gestor de Movilidad",
        department: "Sostenibilidad",
        employeeCode: "EMP-42",
        expiresAt: "06 de noviembre de 2026",
        invitationLink: "http://localhost:5173/enterprise/invitation/accept?token=tok123",
        frontendUrl: "http://localhost:5173",
      };

      const rendered = templateService.renderTemplate(
        "enterprise_invitation",
        templateData,
      );

      assert.ok(rendered.subject, "El asunto debe existir");
      assert.strictEqual(
        rendered.subject,
        "Invitación para unirte a Acme Mobility Corp en YouConnext",
      );

      assert.ok(
        rendered.html.includes("Acme Mobility Corp"),
        "El HTML debe incluir el nombre de la empresa",
      );
      assert.ok(
        rendered.html.includes("Gestor de Movilidad"),
        "El HTML debe incluir el rol formateado",
      );
      assert.ok(
        rendered.html.includes("Sostenibilidad"),
        "El HTML debe incluir el departamento",
      );
      assert.ok(
        rendered.html.includes("06 de noviembre de 2026"),
        "El HTML debe incluir la fecha de caducidad",
      );
      assert.ok(
        rendered.html.includes("http://localhost:5173/enterprise/invitation/accept?token=tok123"),
        "El HTML debe incluir el enlace de invitación",
      );
      assert.ok(
        rendered.html.includes("#2563eb"),
        "El HTML debe utilizar la paleta de color oficial YouConnext (#2563eb)",
      );

      assert.ok(
        rendered.text.includes("Acme Mobility Corp"),
        "La versión texto debe contener el nombre de la empresa",
      );
    });
  });

  describe("Procesamiento del evento enterprise.member.invited", () => {
    it("Debe procesar el evento completo y enviar el email con los datos correctos", async () => {
      const eventPayload = {
        invitation_id: "inv-999",
        enterprise_id: "ent-100",
        enterprise_name: "Tech Solutions S.L.",
        email: "candidato@techsolutions.com",
        role: "ADMIN",
        department: "Tecnología",
        employee_code: "TECH-101",
        token: "crypto-secure-token-64hex",
        expires_at: "2026-11-10T10:00:00.000Z",
        invitation_link: "https://youconnext.es/enterprise/invitation/accept?token=crypto-secure-token-64hex",
        invited_by: "director@techsolutions.com",
      };

      await enterpriseEventHandler.handle(
        "enterprise.member.invited",
        eventPayload,
      );

      assert.strictEqual(
        sentEmails.length,
        1,
        "Debe haberse invocado sendEmail exactamente 1 vez",
      );

      const sent = sentEmails[0];
      assert.strictEqual(sent.to, "candidato@techsolutions.com");
      assert.strictEqual(
        sent.subject,
        "Invitación para unirte a Tech Solutions S.L. en YouConnext",
      );
      assert.ok(sent.html.includes("Tech Solutions S.L."));
      assert.ok(sent.html.includes("Administrador de Organización"));
      assert.ok(sent.html.includes("Tecnología"));
      assert.ok(
        sent.html.includes(
          "https://youconnext.es/enterprise/invitation/accept?token=crypto-secure-token-64hex",
        ),
      );
    });

    it("Debe ignorar el evento si faltan campos obligatorios (email o enterprise_name)", async () => {
      await enterpriseEventHandler.handle("enterprise.member.invited", {
        enterprise_name: "Empresa Sin Email",
      });
      assert.strictEqual(sentEmails.length, 0);

      await enterpriseEventHandler.handle("enterprise.member.invited", {
        email: "sinempresa@test.com",
      });
      assert.strictEqual(sentEmails.length, 0);
    });

    it("Debe construir un enlace de invitación por defecto si no se proporciona invitation_link", async () => {
      const eventPayload = {
        enterprise_id: "ent-200",
        enterprise_name: "Logística Express",
        email: "chofer@logistica.com",
        role: "EMPLOYEE",
        token: "token-fallback-xyz",
        expires_at: null,
      };

      await enterpriseEventHandler.handle(
        "enterprise.member.invited",
        eventPayload,
      );

      assert.strictEqual(sentEmails.length, 1);
      const sent = sentEmails[0];
      assert.ok(
        sent.html.includes("/enterprise/invitation/accept?token=token-fallback-xyz"),
        "Debe generar la URL con el token si invitation_link no viene precalculado",
      );
    });
  });

  describe("Integración con RabbitMQ Consumer", () => {
    it("Debe registrar enterpriseEventHandler en la routing key 'enterprise.*'", () => {
      assert.ok(
        rabbitmqConsumer.ROUTING_KEY_HANDLERS["enterprise.*"],
        "Debe existir un handler para 'enterprise.*'",
      );
      assert.strictEqual(
        rabbitmqConsumer.ROUTING_KEY_HANDLERS["enterprise.*"],
        enterpriseEventHandler,
      );
      assert.strictEqual(
        rabbitmqConsumer.QUEUE_ENTERPRISE,
        "notifications.enterprise.events",
      );
      assert.strictEqual(rabbitmqConsumer.ROUTING_KEY_ENTERPRISE, "enterprise.*");
    });

    it("processMessage: Debe despachar mensajes envueltos en { data: ... } y confirmar (ack)", async () => {
      let ackCalled = false;
      let nackCalled = false;

      const mockChannel = {
        ack: () => {
          ackCalled = true;
        },
        nack: () => {
          nackCalled = true;
        },
      };

      const mockMsg = {
        fields: {
          routingKey: "enterprise.member.invited",
        },
        content: Buffer.from(
          JSON.stringify({
            event: "enterprise.member.invited",
            source: "carpooling-user",
            data: {
              enterprise_id: "ent-300",
              enterprise_name: "Innovación 360",
              email: "socio@innovacion.com",
              role: "MANAGER",
              token: "tok-enveloped-123",
            },
          }),
        ),
      };

      await rabbitmqConsumer.processMessage(
        mockMsg,
        mockChannel,
        "enterprise.*",
      );

      assert.strictEqual(ackCalled, true, "El mensaje debe confirmarse con ack");
      assert.strictEqual(nackCalled, false, "No debe llamarse a nack");
      assert.strictEqual(sentEmails.length, 1);
      assert.strictEqual(sentEmails[0].to, "socio@innovacion.com");
    });
  });
});
