const config = require("../../config");
const {
  JOB_KINDS,
  NOTIFICATION_CHANNELS,
  NOTIFICATION_PRIORITIES,
} = require("../../constants");
const { isValidEmail } = require("../../security");
const notificationQueue = require("../notificationQueue");
const userDirectoryService = require("../userDirectoryService");
const { chunkArray, deduplicateIds } = require("../../utils/templateInterpolator");

const ENQUEUE_SLICE_SIZE = 25;

async function enqueueSingleEmailJobs(emailPayloads) {
  const jobResults = [];
  for (const slice of chunkArray(emailPayloads, ENQUEUE_SLICE_SIZE)) {
    const sliceResults = await Promise.all(
      slice.map((payload) => notificationQueue.enqueueEmail(payload)),
    );
    jobResults.push(...sliceResults);
  }
  return jobResults;
}

/**
 * Encola el envío de emails por lote:
 * - Si recibe userIds (desde ms-trayectos), delega la consulta batch a ms-usuarios
 *   en workers asíncronos (jobs users_lookup_fanout).
 * - Si recibe recipients con email explícito, hace fan-out directo a 1 job por destinatario.
 */
async function enqueueBatch({
  batchId,
  type,
  template,
  sharedData = {},
  userIds = [],
  recipients = [],
  priority = NOTIFICATION_PRIORITIES.NORMAL,
}) {
  const baseData = {
    ...sharedData,
    frontendUrl: sharedData.frontendUrl || config.frontendUrl || "",
  };

  const explicitEmailPayloads = [];
  const unresolvedUserIds = [...userIds];
  const seenEmails = new Set();

  for (const recipient of recipients) {
    if (recipient && isValidEmail(recipient.email)) {
      const normalizedEmail = recipient.email.trim().toLowerCase();
      if (seenEmails.has(normalizedEmail)) continue;
      seenEmails.add(normalizedEmail);

      explicitEmailPayloads.push({
        batchId,
        userId: recipient.userId ? String(recipient.userId) : undefined,
        to: recipient.email.trim(),
        template,
        data: {
          ...baseData,
          ...(recipient.data || {}),
        },
        priority,
      });
    } else if (recipient && recipient.userId) {
      unresolvedUserIds.push(recipient.userId);
    }
  }

  const jobIds = [];
  let queueType = "rabbitmq";

  if (explicitEmailPayloads.length > 0) {
    const directJobs = await enqueueSingleEmailJobs(explicitEmailPayloads);
    for (const r of directJobs) {
      jobIds.push(r.jobId);
      queueType = r.queueType;
    }
  }

  const uniqueUserIds = deduplicateIds(unresolvedUserIds);
  if (uniqueUserIds.length > 0) {
    const lookupChunkSize = config.batch.emailLookupChunkSize || 200;
    for (const userChunk of chunkArray(uniqueUserIds, lookupChunkSize)) {
      const queued = await notificationQueue.enqueueEmail({
        jobKind: JOB_KINDS.USERS_LOOKUP_FANOUT,
        batchId,
        type,
        template,
        sharedData: baseData,
        userIds: userChunk,
        priority,
      });
      jobIds.push(queued.jobId);
      queueType = queued.queueType;
    }
  }

  const totalRecipients = explicitEmailPayloads.length + uniqueUserIds.length;
  if (totalRecipients === 0) {
    return {
      channel: NOTIFICATION_CHANNELS.EMAIL,
      status: "skipped",
      recipientsCount: 0,
      jobsQueued: 0,
      jobIds: [],
    };
  }

  return {
    channel: NOTIFICATION_CHANNELS.EMAIL,
    status: "queued",
    recipientsCount: totalRecipients,
    jobsQueued: jobIds.length,
    jobIds,
    queueType,
  };
}

/**
 * Ejecutado por el worker Email:
 * Resuelve emails en lote contra ms-usuarios y hace fan-out en 1 job atómico por correo.
 */
async function processLookupFanoutJob(payload) {
  const uniqueUserIds = deduplicateIds(payload.userIds);
  if (uniqueUserIds.length === 0) {
    return { skipped: true, reason: "empty_user_ids" };
  }

  const users = await userDirectoryService.resolveUsersByIds(uniqueUserIds);
  if (users.length === 0) {
    return {
      skipped: true,
      reason: "no_resolved_emails",
      usersRequested: uniqueUserIds.length,
    };
  }

  const emailJobs = users.map((user) => ({
    batchId: payload.batchId,
    userId: user.userId,
    to: user.email,
    template: payload.template,
    data: {
      ...(payload.sharedData || {}),
      userName: user.name || payload.sharedData?.userName || "",
      frontendUrl: payload.sharedData?.frontendUrl || config.frontendUrl || "",
    },
    priority: payload.priority || "normal",
  }));

  const enqueued = await enqueueSingleEmailJobs(emailJobs);

  return {
    usersRequested: uniqueUserIds.length,
    resolvedUsers: users.length,
    enqueuedEmails: enqueued.length,
  };
}

module.exports = {
  enqueueBatch,
  processLookupFanoutJob,
  enqueueSingleEmailJobs,
};
