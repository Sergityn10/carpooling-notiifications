const { initializeApp, cert, getApps } = require("firebase-admin/app");
const { getMessaging } = require("firebase-admin/messaging");
const config = require("../config");

function initFirebase() {
  if (!config.firebase.projectId || !config.firebase.clientEmail || !config.firebase.privateKey) {
    throw new Error("Firebase no configurado. Revisa FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL y FIREBASE_PRIVATE_KEY en .env");
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

async function sendToToken(token, payload) {
  const messaging = initFirebase();

  const message = {
    token,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data || {},
    android: {
      priority: payload.priority || "high",
      notification: {
        channelId: payload.channelId || "default",
        sound: "default",
      },
    },
    apns: {
      payload: {
        aps: {
          sound: "default",
          badge: payload.badge || 1,
        },
      },
    },
  };

  const messageId = await messaging.send(message);
  return { success: true, messageId };
}

async function sendToTokens(tokens, payload) {
  const results = [];

  for (const token of tokens) {
    try {
      const result = await sendToToken(token, payload);
      results.push({ token, success: true, messageId: result.messageId });
    } catch (error) {
      results.push({ token, success: false, error: error.message });
    }
  }

  return results;
}

async function sendToTopic(topic, payload) {
  const messaging = initFirebase();

  const message = {
    topic,
    notification: {
      title: payload.title,
      body: payload.body,
    },
    data: payload.data || {},
    android: {
      priority: payload.priority || "high",
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
  sendToToken,
  sendToTokens,
  sendToTopic,
  subscribeToTopic,
  unsubscribeFromTopic,
};
