const mqtt = require('mqtt');

const { config } = require('../db');
const { recordTiming } = require('../services/timingService');
const {
  getActiveEvent,
  getHeatById
} = require('../services/eventService');
const { determineParticipantForStart } = require('../services/raceLogic');

let statusStartGate = false;
let statusStopGate = false;
let lastTagUUID = null;
let lastStartRaw = null;
let lastStartDate = null;
let lastContext = null;

async function recordPendingDnf() {
  if (!lastStartDate || !lastStartRaw || !lastContext) {
    return;
  }
  if (lastContext.eventType !== 'race' || !lastContext.eventId) {
    return;
  }
  try {
    await recordTiming({
      tagId: lastContext.tagId,
      startTime: lastStartRaw,
      elapsedMs: 0,
      eventId: lastContext.eventId,
      participantId: lastContext.participantId,
      bibNumber: lastContext.bibNumber,
      heatId: lastContext.heatId,
      heatName: lastContext.heatName,
      status: 'dnf'
    });
  } catch (err) {
    console.error('[ERROR] record DNF:', err.message);
  }
}

function parseTimePayload(payload) {
  const [h = 0, m = 0, s = 0, cs = 0] = payload.split(/[:.]/).map(Number);
  const baseDate = new Date();
  baseDate.setHours(h, m, s, cs * 10);
  return baseDate;
}

async function handleStart(payload) {
  await recordPendingDnf();
  lastStartRaw = payload;
  lastStartDate = parseTimePayload(payload);
  const activeEvent = await getActiveEvent();
  let context = {
    tagId: lastTagUUID || 'Sconosciuto',
    eventId: activeEvent?.id || null,
    participantId: null,
    bibNumber: null,
    heatId: activeEvent?.current_heat_id || null,
    heatName: null,
    eventType: activeEvent?.type || null
  };

  if (activeEvent?.current_heat_id) {
    const heat = await getHeatById(activeEvent.current_heat_id);
    if (heat) {
      context.heatId = heat.id;
      context.heatName = heat.name;
    }
  }

  if (activeEvent?.type === 'race') {
    const { participant } = await determineParticipantForStart(activeEvent, lastTagUUID);
    if (participant) {
      context.participantId = participant.id;
      context.bibNumber = participant.bib_number;
      context.tagId = participant.tag_uuid || context.tagId;
    }
  } else if (activeEvent?.type === 'training') {
    context.tagId = lastTagUUID || 'Sconosciuto';
  }

  lastContext = context;
  lastTagUUID = null;
}

async function handleStop(payload) {
  if (!lastStartDate || !lastStartRaw) {
    return;
  }
  const endDate = parseTimePayload(payload);
  let elapsed = endDate - lastStartDate;
  if (elapsed < 0) {
    elapsed += 24 * 3600 * 1000;
  }

  const context = lastContext || {
    tagId: lastTagUUID || 'Sconosciuto',
    eventId: null,
    participantId: null,
    bibNumber: null,
    heatId: null,
    heatName: null,
    eventType: null
  };

  try {
    await recordTiming({
      tagId: context.tagId,
      startTime: lastStartRaw,
      elapsedMs: elapsed,
      eventId: context.eventId,
      participantId: context.participantId,
      bibNumber: context.bibNumber,
      heatId: context.heatId,
      heatName: context.heatName,
      status: 'completed'
    });
  } catch (err) {
    console.error('[ERROR] insert timing:', err.message);
  }

  lastStartRaw = null;
  lastStartDate = null;
  lastContext = null;
}

async function handleMessage(topic, message) {
  const payload = message.toString().trim();

  if (topic === config.mqtt.topicStatusStartGate) {
    statusStartGate = payload.toLowerCase() === 'online';
    return;
  }
  if (topic === config.mqtt.topicStatusStopGate) {
    statusStopGate = payload.toLowerCase() === 'online';
    return;
  }
  if (topic === config.mqtt.topicTag) {
    lastTagUUID = payload;
    return;
  }
  if (topic === config.mqtt.topicStart) {
    await handleStart(payload);
    return;
  }
  if (topic === config.mqtt.topicEnd) {
    await handleStop(payload);
    return;
  }

  console.log('[DEBUG] Messaggio non riconosciuto:', topic, payload);
}

function createClient() {
  const client = mqtt.connect(config.mqtt.brokerUrl, config.mqtt.options);
  client.on('connect', () => {
    console.log('✓ MQTT connected');
    client.subscribe(
      [
        config.mqtt.topicStatusStartGate,
        config.mqtt.topicStatusStopGate,
        config.mqtt.topicTag,
        config.mqtt.topicStart,
        config.mqtt.topicEnd
      ],
      err => {
        if (err) {
          console.error('[ERROR] subscribe MQTT:', err.message);
        }
      }
    );
  });

  client.on('message', (topic, message) => {
    handleMessage(topic, message).catch(err => {
      console.error('[ERROR] MQTT handler:', err);
    });
  });

  client.on('error', err => {
    console.error('[ERROR] MQTT client:', err && err.message ? err.message : err);
  });

  return client;
}

function getGateStatus() {
  return { startGate: statusStartGate, stopGate: statusStopGate };
}

module.exports = {
  createClient,
  getGateStatus
};
