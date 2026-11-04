const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const config = require("../config");
const deviceTokenService = require("./deviceTokenService");

function initFirebase() {
  if (
    !config.firebase.projectId ||
    !config.firebase.clientEmail ||
    !config.firebase.privateKey
  ) {
    throw new Error(
      "Firebase no configurado. Revisa FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY en .env",
    );
  }

  if (getApps().length === 0) {
    initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });
  }

  return getMessaging();
}

function isInitialized() {
  return getApps().length > 0;
}

/**
 * Convierte valores de datos a string para compatibilidad estricta con FCM data payload.
 */
function normalizeDataPayload(data = {}) {
  const normalized = {};
  for (const [k, v] of Object.entries(data)) {
    normalized[k] = typeof v === "object" ? JSON.stringify(v) : String(v);
  }
  return normalized;
}

/**
 * Envío directo a un único token FCM.
 */
async function sendToTokenDirect(token, payload) {
  const messaging = initFirebase();

  const message = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: normalizeDataPayload(payload.data),
    android: {
      priority: payload.priority === "high" ? "high" : "normal",
      notification: {
        channelId: payload.channelId || "default",
        sound: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: typeof payload.badge === "number" ? payload.badge : 1,
        },
      },
    },
  };

  try {
    const messageId = await messaging.send(message);
    return { success: true, messageId };
  } catch (error) {
    // Si el token es inválido o expiró en el dispositivo móvil, desactivarlo
    if (
      error.code === "messaging/invalid-registration-token" ||
      error.code === "messaging/registration-token-not-registered"
    ) {
      console.warn(`[PushService] Desactivando token FCM obsoleto: ${token}`);
      deviceTokenService.deactivateDeviceToken(null, token).catch(() => {});
    }
    throw error;
  }
}

/**
 * Envío optimizado a múltiples tokens mediante sendEachForMulticast (en lotes de 500).
 * Elimina el cuello de botella de bucles secuenciales O(N) de llamadas HTTP.
 */
async function sendToTokensDirect(tokens, payload) {
  if (!Array.isArray(tokens) || tokens.length === 0) {
    return [];
  }

  const messaging = initFirebase();
  const allResults = [];
  const CHUNK_SIZE = 500;

  for (let i = 0; i < tokens.length; i += CHUNK_SIZE) {
    const chunkTokens = tokens.slice(i, i + CHUNK_SIZE);

    const multicastMessage = {
      tokens: chunkTokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: normalizeDataPayload(payload.data),
      android: {
        priority: payload.priority === "high" ? "high" : "normal",
        notification: {
          channelId: payload.channelId || "default",
          sound: "default",
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
            badge: typeof payload.badge === "number" ? payload.badge : 1,
          },
        },
      },
    };

    try {
      const response = await messaging.sendEachForMulticast(multicastMessage);

      response.responses.forEach((resp, index) => {
        const token = chunkTokens[index];
        if (resp.success) {
          allResults.push({
            token,
            success: true,
            messageId: resp.messageId,
          });
        } else {
          const errCode = resp.error?.code;
          if (
            errCode === "messaging/invalid-registration-token" ||
            errCode === "messaging/registration-token-not-registered"
          ) {
            deviceTokenService.deactivateDeviceToken(null, token).catch(() => {});
          }
          allResults.push({
            token,
            success: false,
            error: resp.error?.message || "Error desconocido FCM",
          });
        }
      });
    } catch (batchError) {
      chunkTokens.forEach((token) => {
        allResults.push({
          token,
          success: false,
          error: batchError.message,
        });
      });
    }
  }

  return allResults;
}

/**
 * Envío directo a un topic de FCM.
 */
async function sendToTopicDirect(topic, payload) {
  const messaging = initFirebase();

  const message = {
    topic,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: normalizeDataPayload(payload.data),
    android: {
      priority: payload.priority === "high" ? "high" : "normal",
    },
  };

  const messageId = await messaging.send(message);
  return { success: true, messageId };
}

async function subscribeToTopic(tokens, topic) {
  const messaging = initFirebase();
  const response = await messaging.subscribeToTopic(tokens, topic);
  return {
    success: response.successCount > 0,
    successCount: response.successCount,
    failureCount: response.failureCount,
    errors: response.errors,
  };
}

async function unsubscribeFromTopic(tokens, topic) {
  const messaging = initFirebase();
  const response = await messaging.unsubscribeFromTopic(tokens, topic);
  return {
    success: response.successCount > 0,
    successCount: response.successCount,
    failureCount: response.failureCount,
    errors: response.errors,
  };
}

module.exports = {
  initFirebase,
  isInitialized,
  sendToToken: sendToTokenDirect,
  sendToTokens: sendToTokensDirect,
  sendToTopic: sendToTopicDirect,
  sendToTokenDirect,
  sendToTokensDirect,
  sendToTopicDirect,
  subscribeToTopic,
  unsubscribeFromTopic,
};
