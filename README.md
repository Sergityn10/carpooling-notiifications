# Carpooling Notifications

Microservicio de notificaciones para Carpooling. Gestiona emails y notificaciones push con FCM, guarda tokens de dispositivos por usuario y usa Prisma ORM con MySQL en Docker.

## Funcionalidades

- **Emails SMTP**: envío simple, por plantilla y en lote.
- **Plantillas HTML**: bienvenida, confirmación de viaje, cancelación, solicitud de reserva y recuperación de contraseña.
- **Push notifications FCM**: envío por token, múltiples tokens, topic o usuario.
- **Registro de dispositivos**: guarda tokens FCM relacionados con `userId`, `email` y `role` del JWT.
- **Multi-dispositivo**: un usuario puede tener varios móviles/dispositivos activos.
- **Autenticación JWT**: middleware con `Authorization: Bearer <JWT>` y clave pública.
- **Persistencia**: Prisma ORM + MySQL en Docker.

## Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Emails**: Nodemailer
- **Push**: Firebase Admin SDK / FCM
- **ORM**: Prisma
- **DB**: MySQL 8.4 en Docker
- **Auth**: JWT RS256 con clave pública

## Requisitos

- **Node.js**: 18+
- **Docker + Docker Compose**
- **Cuenta SMTP**: Gmail, SendGrid, Mailtrap, etc.
- **Proyecto Firebase** con credenciales de service account
- **Clave pública JWT** del servicio que emite los tokens

## Instalación inicial

```bash
npm install
cp .env.example .env
npm run db:up
npm run prisma:migrate -- --name init_device_tokens
npm run dev
```

Después edita `.env` con tus credenciales reales.

## Variables de entorno

Ejemplo completo:

```env
# Server
PORT=3004
NODE_ENV=development

# Database
DATABASE_URL="mysql://carpooling_notifications_user:carpooling_notifications_password@localhost:3307/carpooling_notifications"

# SMTP Configuration
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your-email@gmail.com
SMTP_PASS=your-app-password
SMTP_FROM_NAME=Carpooling
SMTP_FROM_EMAIL=noreply@carpooling.com

# Frontend URL
FRONTEND_URL=http://localhost:3000

# JWT Verification
JWT_ALGORITHM=RS256
JWT_PUBLIC_KEY="-----BEGIN PUBLIC KEY-----\nMIIB...\n-----END PUBLIC KEY-----\n"

# Firebase / FCM Configuration
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project-id.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\nMIIE...\n-----END PRIVATE KEY-----\n"
```

## Base de datos MySQL con Docker

La base de datos se levanta con `docker-compose.yml` usando la imagen oficial `mysql:8.4`.

Prisma es quien crea y actualiza las tablas mediante migraciones. No hay scripts SQL manuales de inicialización.

### Datos por defecto

- **Host**: `localhost`
- **Puerto externo**: `3307`
- **Puerto interno Docker**: `3306`
- **Database**: `carpooling_notifications`
- **Usuario**: `carpooling_notifications_user`
- **Password**: `carpooling_notifications_password`

### Comandos DB

```bash
npm run db:up       # Levantar MySQL
npm run db:logs     # Ver logs de MySQL
npm run db:down     # Parar MySQL
```

### Comandos Prisma

```bash
npm run prisma:migrate -- --name nombre_migracion
npm run prisma:generate
npm run prisma:studio
```

## Scripts disponibles

| Script | Descripción |
|--------|-------------|
| `npm start` | Arranca el servidor en modo normal |
| `npm run dev` | Arranca el servidor con `node --watch` |
| `npm test` | Ejecuta tests con `node --test` |
| `npm run db:up` | Levanta MySQL en Docker |
| `npm run db:down` | Para los contenedores Docker |
| `npm run db:logs` | Muestra logs de MySQL |
| `npm run prisma:migrate` | Ejecuta migraciones Prisma |
| `npm run prisma:generate` | Genera Prisma Client |
| `npm run prisma:studio` | Abre Prisma Studio |

## Modelo de datos

### `UserDeviceToken`

Guarda la relación entre usuario y dispositivo.

| Campo | Descripción |
|-------|-------------|
| `id` | ID interno del registro |
| `userId` | ID del usuario extraído del JWT |
| `email` | Email del usuario extraído del JWT |
| `role` | Rol del usuario extraído del JWT |
| `token` | Token FCM del dispositivo |
| `platform` | Plataforma opcional: `android`, `ios`, `web`, etc. |
| `deviceId` | ID estable del dispositivo |
| `deviceName` | Nombre legible del dispositivo |
| `active` | Indica si el dispositivo está activo |
| `lastUsedAt` | Último uso/registro del token |
| `createdAt` | Fecha de creación |
| `updatedAt` | Fecha de actualización |

Reglas importantes:

- **Un usuario puede tener varios dispositivos**.
- **Un token FCM es único**.
- **La combinación `userId + deviceId` es única** si se envía `deviceId`.
- Al registrar otra vez el mismo token/dispositivo, se actualiza el registro existente.

## Autenticación JWT

Los endpoints de dispositivos requieren:

```http
Authorization: Bearer <JWT>
```

El JWT debe estar firmado con el algoritmo configurado en `JWT_ALGORITHM` y verificarse con `JWT_PUBLIC_KEY`.

Payload esperado:

```json
{
  "userId": "user-id",
  "email": "user@example.com",
  "role": "user"
}
```

## Endpoints

### Health

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/health` | Estado del servicio |
| `GET` | `/api/emails/health/smtp` | Verifica conexión SMTP |

### Emails

| Método | Ruta | Descripción |
|--------|------|-------------|
| `GET` | `/api/emails/templates` | Lista las plantillas disponibles |
| `POST` | `/api/emails/send` | Envía un email con HTML/texto personalizado |
| `POST` | `/api/emails/send/template` | Envía un email usando una plantilla predefinida |
| `POST` | `/api/emails/send/batch` | Envía múltiples emails en lote |

### Push notifications FCM

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/push/send` | Envía push a un dispositivo por token |
| `POST` | `/api/push/send/multicast` | Envía push a múltiples tokens |
| `POST` | `/api/push/send/user` | Envía push a todos los dispositivos activos de un usuario |
| `POST` | `/api/push/send/topic` | Envía push a un topic |
| `POST` | `/api/push/topic/subscribe` | Suscribe tokens a un topic |
| `POST` | `/api/push/topic/unsubscribe` | Desuscribe tokens de un topic |

### Device tokens

Requieren JWT Bearer.

| Método | Ruta | Descripción |
|--------|------|-------------|
| `POST` | `/api/device-tokens` | Registra o actualiza el token FCM del dispositivo autenticado |
| `GET` | `/api/device-tokens/me` | Lista los dispositivos activos del usuario autenticado |
| `DELETE` | `/api/device-tokens` | Desactiva un dispositivo por `token` o `deviceId` |

## Ejemplos

### Ver estado del servicio

```bash
curl http://localhost:3004/health
```

### Verificar SMTP

```bash
curl http://localhost:3004/api/emails/health/smtp
```

### Enviar email con plantilla

```bash
curl -X POST http://localhost:3004/api/emails/send/template \
  -H "Content-Type: application/json" \
  -d '{
    "to": "usuario@example.com",
    "template": "welcome",
    "data": { "name": "Sergio" }
  }'
```

### Enviar email personalizado

```bash
curl -X POST http://localhost:3004/api/emails/send \
  -H "Content-Type: application/json" \
  -d '{
    "to": "usuario@example.com",
    "subject": "Hola",
    "html": "<h1>Mensaje de prueba</h1>"
  }'
```

### Enviar lote de emails

```bash
curl -X POST http://localhost:3004/api/emails/send/batch \
  -H "Content-Type: application/json" \
  -d '{
    "emails": [
      { "to": "a@example.com", "subject": "Hola", "html": "<p>Email 1</p>" },
      { "to": "b@example.com", "subject": "Hola", "html": "<p>Email 2</p>" }
    ]
  }'
```

### Registrar token FCM del dispositivo autenticado

```bash
curl -X POST http://localhost:3004/api/device-tokens \
  -H "Authorization: Bearer TU_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "token": "FCM_TOKEN_DEL_MOVIL",
    "platform": "android",
    "deviceId": "pixel-7-sergio",
    "deviceName": "Pixel 7"
  }'
```

### Listar mis dispositivos activos

```bash
curl http://localhost:3004/api/device-tokens/me \
  -H "Authorization: Bearer TU_JWT"
```

### Desactivar un dispositivo por `deviceId`

```bash
curl -X DELETE http://localhost:3004/api/device-tokens \
  -H "Authorization: Bearer TU_JWT" \
  -H "Content-Type: application/json" \
  -d '{
    "deviceId": "pixel-7-sergio"
  }'
```

### Enviar push a un token concreto

```bash
curl -X POST http://localhost:3004/api/push/send \
  -H "Content-Type: application/json" \
  -d '{
    "token": "FCM_TOKEN_DEL_MOVIL",
    "title": "Nuevo viaje disponible",
    "body": "Hay un viaje que coincide con tu ruta",
    "data": { "tripId": "123", "type": "trip_match" }
  }'
```

### Enviar push a todos los dispositivos de un usuario

```bash
curl -X POST http://localhost:3004/api/push/send/user \
  -H "Content-Type: application/json" \
  -d '{
    "userId": "USER_ID",
    "title": "Nuevo mensaje",
    "body": "Tienes una nueva notificación",
    "data": { "type": "message" }
  }'
```

### Enviar push a un topic

```bash
curl -X POST http://localhost:3004/api/push/send/topic \
  -H "Content-Type: application/json" \
  -d '{
    "topic": "trips_madrid_barcelona",
    "title": "Nuevo viaje",
    "body": "Se ha publicado un viaje Madrid → Barcelona"
  }'
```

## Plantillas de email disponibles

| Nombre | Campos requeridos |
|--------|-------------------|
| `welcome` | `name` |
| `trip_confirmation` | `userName`, `origin`, `destination`, `date`, `time`, `seats`, `price`, `tripId` |
| `trip_cancelled` | `userName`, `origin`, `destination`, `date`, `time`, `reason` |
| `booking_request` | `driverName`, `passengerName`, `origin`, `destination`, `date`, `time`, `seatsRequested`, `tripId` |
| `password_reset` | `name`, `resetUrl` |

## Configuración Gmail SMTP

Para Gmail no uses tu contraseña normal. Usa una **App Password**.

Pasos:

1. Activa verificación en 2 pasos en tu cuenta Google.
2. Crea una App Password en Google Account.
3. Configura:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=tu-email@gmail.com
SMTP_PASS=tu-app-password-sin-espacios
SMTP_FROM_NAME=Carpooling
SMTP_FROM_EMAIL=tu-email@gmail.com
```

## Configuración Firebase FCM

Desde Firebase Console:

1. Entra en tu proyecto.
2. Ve a **Project settings** → **Service accounts**.
3. Genera una nueva clave privada.
4. Copia estos campos al `.env`:

```env
FIREBASE_PROJECT_ID=project_id
FIREBASE_CLIENT_EMAIL=client_email
FIREBASE_PRIVATE_KEY="private_key_con_\\n"
```

El archivo JSON de Firebase no debe subirse al repositorio.

## Flujo recomendado para móvil

1. La app móvil obtiene el token FCM.
2. La app llama a `POST /api/device-tokens` con el JWT del usuario.
3. El microservicio guarda la relación `userId -> dispositivo -> token FCM`.
4. Cualquier servicio puede pedir envío por `userId` usando `POST /api/push/send/user`.
5. Si el usuario cierra sesión o elimina dispositivo, llamar a `DELETE /api/device-tokens`.

## Estructura del proyecto

```text
.
├── docker-compose.yml
├── package.json
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── config/
│   ├── controllers/
│   ├── lib/
│   ├── middleware/
│   ├── routes/
│   ├── services/
│   ├── templates/
│   └── server.js
└── README.md
```

## Troubleshooting

### Docker pide `docker-credential-desktop`

Si aparece:

```bash
error getting credentials - err: exec: "docker-credential-desktop": executable file not found in $PATH
```

Corrige `~/.docker/config.json` eliminando `credsStore: desktop` o `credHelpers` con `desktop`.

### Prisma no conecta a MySQL

Comprueba:

```bash
npm run db:up
npm run db:logs
npx prisma validate
```

Y revisa que `DATABASE_URL` apunte a `localhost:3307`.

### JWT inválido

Comprueba que:

- El token se manda como `Authorization: Bearer <JWT>`.
- El payload contiene `{ userId, email, role }`.
- `JWT_PUBLIC_KEY` corresponde a la clave privada con la que se firmó el JWT.
- `JWT_ALGORITHM` coincide con el algoritmo de firma.

### Gmail SMTP falla con `535 BadCredentials`

Usa una App Password de Gmail, no la contraseña normal.
