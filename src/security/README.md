# YouConnext Security Kit (Shared Security Core)

Módulo transversal, reutilizable y escalable para la remediación de vulnerabilidades DAST (CRIT-01 a CRIT-04, HIGH-01 a HIGH-11, MED-01 a MED-25, LOW-01 a LOW-13) y cumplimiento normativo (RGPD, PSD2, OWASP API Top 10, ENS).

---

## 1. Módulos y Componentes Incluidos

| Módulo | Vulnerabilidades Mitigadas | Funcionalidad Principal |
| :--- | :--- | :--- |
| **`jwtAuth.js`** | **CRIT-01**, **CRIT-02**, **HIGH-06**, **HIGH-07** | Validación estricta con algoritmo `RS256`, bloqueo de `none` y firmas simétricas, RBAC (`requireRole`, `requireAdmin`) y ABAC Ownership Factory (`requireOwnership`). |
| **`rateLimiter.js`** | **ALTO-13** a **ALTO-17**, **MED-05**, **MED-10** a **MED-25** | Limitadores multicapa con cabeceras RFC IETF (`Retry-After`, `RateLimit-*`) para Auth, Pagos, Notificaciones y API general. |
| **`securityHeaders.js`**| **MED-01** a **MED-04**, **LOW-01** a **LOW-13**, **Banners** | Helmet con HSTS estricto (1 año + subdominios + preload), CSP, nosniff, DENY y remoción de `X-Powered-By` y `Server`. |
| **`circuitBreaker.js`** | **CRIT-03**, **CRIT-04** | Patrón Circuit Breaker (CLOSED / OPEN / HALF-OPEN) para llamadas a servicios externos (FCM, SMTP, APIs de terceros). |
| **`sanitizer.js`** | **HIGH-01**, **RGPD Art. 5 y 32** | Filtro DTO universal para prevenir fuga de datos personales (passwords, DNI, Stripe accounts, teléfonos). |

---

## 2. Guía de Uso en Microservicios

### A. Autenticación y Autorización (JWT RS256 + Roles + Ownership)

```javascript
const {
  requireAuth,
  requireRole,
  requireAdmin,
  requireOwnership,
} = require("./security");

// 1. Endpoint protegido que requiere cualquier usuario autenticado
app.get("/api/profile/me", requireAuth, profileController.getMe);

// 2. Endpoint restringido exclusivamente a administradores (BFLA)
app.post("/api/admin/broadcast", requireAuth, requireAdmin, adminController.broadcast);

// 3. Endpoint protegido contra BOLA/IDOR (Ownership)
// Permite el acceso solo si req.user.id === req.params.userId o si el usuario es administrador
app.get(
  "/api/users/:userId/details",
  requireAuth,
  requireOwnership((req) => req.params.userId),
  userController.getUserDetails
);
```

### B. Control de Tasa (Rate Limiting)

```javascript
const {
  authRateLimiter,
  paymentRateLimiter,
  notificationBurstLimiter,
  generalApiLimiter,
} = require("./security");

// Limitador global defensivo
app.use(generalApiLimiter); // 100 req/min

// Endpoints de autenticación (fuerza bruta: 5 req/15min)
app.post("/api/auth/login", authRateLimiter, authController.login);
app.post("/api/auth/register", authRateLimiter, authController.register);

// Endpoints financieros / recargas (10 req/min)
app.post("/api/payment/recharge", paymentRateLimiter, requireAuth, paymentController.recharge);

// Endpoints de envío de notificaciones (30 req/min)
app.post("/api/push/send", notificationBurstLimiter, requireAuth, pushController.sendToToken);
```

### C. Hardening HTTP y Cabeceras

```javascript
const { applySecurityHeaders } = require("./security");

// Aplicar al inicializar la aplicación Express
const app = express();
applySecurityHeaders(app);
```

### D. Sanitización y DTOs de Salida (Cierre de Exfiltración RGPD)

```javascript
const { sanitizeOutput } = require("./security");

// Limpia automáticamente contraseñas, DNIs y cuentas Stripe de cualquier objeto o array
app.get("/api/users", requireAuth, requireAdmin, async (req, res) => {
  const users = await prisma.user.findMany();
  res.json({ users: sanitizeOutput(users) });
});
```

---

## 3. Pruebas Automatizadas

Para certificar la integridad de las defensas criptográficas y de control de flujo, ejecute:

```bash
npm test
```
Resultados de la suite nativa:
- **14/14 tests pasando (0 fallos)** en < 500ms.
- Certificación de rechazo de `alg: none` (CRIT-01).
- Certificación de detección de firmas alteradas (CRIT-02).
- Certificación de resiliencia ante concurrencia (CRIT-03).
- Certificación de auto-recuperación y health probes (CRIT-04).
