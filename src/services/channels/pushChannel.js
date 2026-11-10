const config = require("../../config");
const {
  JOB_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
} = require("../../constants");
const deviceTokenService = require("../deviceTokenService");
const pushService = require("../pushService");
const notificationQueue = require("../notificationQueue");
const { chunkArray, deduplicateIds } = require("../../utils/templateInterpolator");

/**
 * Encola envíos Push por lote fragmentando userIds (o tokens) en chunks acotados.
 * No realiza consultas Prisma en el hilo HTTP para mantener respuestas < 20ms.
 */
async function enqueueBatch({
  batchId,
  title,
  body,
  data = {},
  priority = NOTIFICATION_PRIORITIES.HIGH,
  channelId = "default",
  badge,
  userIds = [],
  tokens = [],
}) {
  const chunkSize = config.batch.pushChunkSize || 500;
  const enrichedData = {
    ...data,
    ...(batchId ? { batchId: String(batchId) } : {}),
  };

  const uniqueUserIds = deduplicateIds(userIds);
  if (uniqueUserIds.length > 0) {
    const jobResults = [];
    for (const userChunk of chunkArray(uniqueUserIds, chunkSize)) {
      const queued = await notificationQueue.enqueuePush({
        jobKind: JOB_KINDS.USERS_BATCH,
        batchId,
        userIds: userChunk,
        title,
        body,
        data: enrichedData,
        priority,
        channelId,
        badge,
      });
      jobResults.push(queued);
    }

    return {
      channel: NOTIFICATION_CHANNELS.PUSH,
      status: "queued",
      recipientsCount: uniqueUserIds.length,
      jobsQueued: jobResults.length,
      jobIds: jobResults.map((r) => r.jobId),
      queueType: jobResults[0]?.queueType || "rabbitmq",
    };
  }

  const uniqueTokens = deduplicateIds(tokens);
  if (uniqueTokens.length > 0) {
    const jobResults = [];
    for (const tokenChunk of chunkArray(uniqueTokens, chunkSize)) {
      const queued = await notificationQueue.enqueuePush({
        batchId,
        tokens: tokenChunk,
        title,
        body,
        data: enrichedData,
        priority,
        channelId,
        badge,
      });
      jobResults.push(queued);
    }

    return {
      channel: NOTIFICATION_CHANNELS.PUSH,
      status: "queued",
      recipientsCount: uniqueTokens.length,
      jobsQueued: jobResults.length,
      jobIds: jobResults.map((r) => r.jobId),
      queueType: jobResults[0]?.queueType || "rabbitmq",
    };
  }

  return {
    channel: NOTIFICATION_CHANNELS.PUSH,
    status: "skipped",
    recipientsCount: 0,
    jobsQueued: 0,
    jobIds: [],
  };
}

/**
 * Ejecutado por el worker Push:
 * 1) 1 única consulta bulk en MySQL para todos los userIds del chunk.
 * 2) Deduplicación de tokens y envío vía FCM Multicast en lotes de hasta 500 tokens.
 */
async function processUsersBatchJob(payload, circuitBreaker) {
  const uniqueUserIds = deduplicateIds(payload.userIds);
  if (uniqueUserIds.length === 0) {
    return { skipped: true, reason: "empty_user_ids" };
  }

  const { tokens } =
    await deviceTokenService.getActiveTokensByUserIds(uniqueUserIds);

  if (tokens.length === 0) {
    return {
      skipped: true,
      reason: "no_active_tokens",
      usersRequested: uniqueUserIds.length,
    };
  }

  let succeeded = 0;
  let failed = 0;
  let chunksProcessed = 0;

  for (const tokenChunk of chunkArray(tokens, 500)) {
    const chunkResults = await circuitBreaker.execute(() =>
      pushService.sendToTokensDirect(tokenChunk, payload),
    );
    chunksProcessed += 1;
    for (const r of chunkResults) {
      if (r.success) succeeded += 1;
      else failed += 1;
    }
  }

  return {
    usersRequested: uniqueUserIds.length,
    totalTokens: tokens.length,
    chunksProcessed,
    succeeded,
    failed,
  };
}

module.exports = {
  enqueueBatch,
  processUsersBatchJob,
};
