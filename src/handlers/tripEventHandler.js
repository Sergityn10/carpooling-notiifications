const notificationOrchestrator = require("../services/notificationOrchestrator");
const {
  INBOUND_EVENTS,
  EVENT_TO_NOTIFICATION_TYPE,
  NOTIFICATION_PRIORITIES,
} = require("../constants");
const { deduplicateIds } = require("../utils/templateInterpolator");

const HANDLER_NAME = "tripEventHandler";

function formatPrice(rawPrice) {
  if (rawPrice === undefined || rawPrice === null || rawPrice === "") return undefined;
  const str = String(rawPrice).trim();
  if (/€|\$|eur|usd/i.test(str)) return str;
  return `${str} €`;
}

function normalizeTripEventPayload(eventType, rawData = {}) {
  const tripObj =
    rawData.trip && typeof rawData.trip === "object" ? rawData.trip : {};
  const shared =
    rawData.sharedData && typeof rawData.sharedData === "object"
      ? rawData.sharedData
      : {};

  const pick = (...keys) => {
    for (const key of keys) {
      if (shared[key] !== undefined && shared[key] !== null) return shared[key];
      if (rawData[key] !== undefined && rawData[key] !== null) return rawData[key];
      if (tripObj[key] !== undefined && tripObj[key] !== null) return tripObj[key];
    }
    return undefined;
  };

  const tripId = pick("tripId", "trip_id", "id");
  const singleUserId = rawData.userId ?? rawData.user_id ?? rawData.driverId ?? rawData.driver_id;
  const rawUserIds =
    rawData.userIds ??
    rawData.user_ids ??
    rawData.interestedUserIds ??
    rawData.interested_user_ids ??
    (singleUserId ? [singleUserId] : []);

  const userIds = deduplicateIds(rawUserIds);
  const recipients = Array.isArray(rawData.recipients) ? rawData.recipients : [];

  const priceRaw = pick("price");
  const formattedPrice = formatPrice(priceRaw);

  const sharedData = {
    ...tripObj,
    ...shared,
    ...(tripId !== undefined ? { tripId: String(tripId) } : {}),
    ...(pick("origin") !== undefined ? { origin: pick("origin") } : {}),
    ...(pick("destination") !== undefined ? { destination: pick("destination") } : {}),
    ...(pick("date") !== undefined ? { date: pick("date") } : {}),
    ...(pick("time") !== undefined ? { time: pick("time") } : {}),
    ...(formattedPrice !== undefined ? { price: formattedPrice } : {}),
    ...(pick("seats", "available_seats", "availableSeats") !== undefined
      ? { seats: pick("seats", "available_seats", "availableSeats") }
      : {}),
    ...(pick("driverName", "driver_name") !== undefined
      ? { driverName: pick("driverName", "driver_name") }
      : {}),
    ...(pick("passengerName", "passenger_name") !== undefined
      ? { passengerName: pick("passengerName", "passenger_name") }
      : {}),
    ...(pick("seatsBooked", "seats_booked") !== undefined
      ? { seatsBooked: pick("seatsBooked", "seats_booked") }
      : {}),
    ...(pick("seatsRemaining", "seats_remaining") !== undefined
      ? { seatsRemaining: pick("seatsRemaining", "seats_remaining") }
      : {}),
    ...(pick("seatsRequested", "seats_requested") !== undefined
      ? { seatsRequested: pick("seatsRequested", "seats_requested") }
      : {}),
    ...(pick("passengers") !== undefined ? { passengers: pick("passengers") } : {}),
    ...(pick("earnings") !== undefined ? { earnings: pick("earnings") } : {}),
    ...(pick("reason") !== undefined ? { reason: pick("reason") } : {}),
    ...(pick("userName", "user_name") !== undefined
      ? { userName: pick("userName", "user_name") }
      : {}),
  };

  const idempotencyKey =
    rawData.idempotencyKey ??
    rawData.idempotency_key ??
    rawData.eventId ??
    rawData.event_id ??
    (tripId ? `${eventType}:${tripId}` : undefined);

  return {
    idempotencyKey,
    channels: rawData.channels,
    priority: rawData.priority || NOTIFICATION_PRIORITIES.HIGH,
    userIds,
    recipients,
    sharedData,
  };
}

function normalizeTripAlertPayload(rawData = {}) {
  return normalizeTripEventPayload(INBOUND_EVENTS.TRIP.ALERT_MATCHED, rawData);
}

async function handleTripDomainEvent(eventType, data) {
  const notificationType = EVENT_TO_NOTIFICATION_TYPE[eventType];
  const normalized = normalizeTripEventPayload(eventType, data);

  if (normalized.userIds.length === 0 && normalized.recipients.length === 0) {
    console.warn(
      `[${HANDLER_NAME}] ${eventType} recibido sin userIds. Se omite despacho (tripId=${normalized.sharedData.tripId || "unknown"}).`,
    );
    return { skipped: true, reason: "empty_user_ids" };
  }

  const result = await notificationOrchestrator.dispatchBatch({
    idempotencyKey: normalized.idempotencyKey,
    type: notificationType,
    channels: normalized.channels,
    priority: normalized.priority,
    sharedData: normalized.sharedData,
    userIds: normalized.userIds,
    recipients: normalized.recipients,
  });

  console.log(
    `[${HANDLER_NAME}] Evento ${eventType} despachado batchId=${result.batchId} tripId=${normalized.sharedData.tripId || "-"} recipients=${result.totalRecipients} deduplicated=${result.deduplicated}`,
  );

  return result;
}

async function handleTripAlertMatched(data) {
  return handleTripDomainEvent(INBOUND_EVENTS.TRIP.ALERT_MATCHED, data);
}

const EVENT_HANDLERS = {
  [INBOUND_EVENTS.TRIP.ALERT_MATCHED]: handleTripAlertMatched,
  [INBOUND_EVENTS.TRIP.CONFIRMED]: (data) =>
    handleTripDomainEvent(INBOUND_EVENTS.TRIP.CONFIRMED, data),
  [INBOUND_EVENTS.TRIP.BOOKED]: (data) =>
    handleTripDomainEvent(INBOUND_EVENTS.TRIP.BOOKED, data),
  [INBOUND_EVENTS.TRIP.CANCELLED]: (data) =>
    handleTripDomainEvent(INBOUND_EVENTS.TRIP.CANCELLED, data),
  [INBOUND_EVENTS.TRIP.STARTED]: (data) =>
    handleTripDomainEvent(INBOUND_EVENTS.TRIP.STARTED, data),
  [INBOUND_EVENTS.TRIP.COMPLETED]: (data) =>
    handleTripDomainEvent(INBOUND_EVENTS.TRIP.COMPLETED, data),
  [INBOUND_EVENTS.TRIP.BOOKING_REQUESTED]: (data) =>
    handleTripDomainEvent(INBOUND_EVENTS.TRIP.BOOKING_REQUESTED, data),
};

async function handle(eventType, data) {
  const handler = EVENT_HANDLERS[eventType];
  if (!handler) {
    console.warn(
      `[${HANDLER_NAME}] No hay handler registrado para el evento: ${eventType}`,
    );
    return;
  }

  return handler(data);
}

module.exports = {
  handle,
  EVENT_HANDLERS,
  handleTripAlertMatched,
  handleTripDomainEvent,
  normalizeTripAlertPayload,
  normalizeTripEventPayload,
};
