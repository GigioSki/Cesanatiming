const {
  listParticipants,
  getParticipantByTag,
  updateEventConfig,
  parseMetadata,
  setNextPointer,
  getEventById
} = require('./eventService');

function sortParticipantsForQueue(participants, startOrder = 'normal') {
  const apripista = participants.find(p => p.bib_number === 0) || null;
  const others = participants
    .filter(p => p.bib_number != null && p.bib_number !== 0)
    .sort((a, b) => a.bib_number - b.bib_number);
  if (startOrder === 'reverse') {
    others.reverse();
  }
  const queue = [];
  if (apripista) queue.push(apripista);
  queue.push(...others);
  return queue;
}

async function buildQueue(event) {
  const participants = await listParticipants(event.id);
  const queue = sortParticipantsForQueue(participants, event.start_order || 'normal');
  return { queue, participants };
}

async function determineParticipantForStart(event, lastTagUUID) {
  if (event.type !== 'race') {
    return { participant: null, queueLength: 0 };
  }

  const metadata = parseMetadata(event);

  if (event.start_mode === 'bracelet') {
    const participant = await getParticipantByTag(event.id, lastTagUUID);
    return { participant, queueLength: 0 };
  }

  const { queue } = await buildQueue(event);
  if (!queue.length) {
    return { participant: null, queueLength: 0 };
  }

  let overrideBib = metadata.overrideBib ?? null;
  let pointer = event.next_pointer || 0;
  let chosen = null;

  if (overrideBib != null) {
    chosen = queue.find(p => p.bib_number === overrideBib) || null;
    if (chosen) {
      const idx = queue.findIndex(p => p.id === chosen.id);
      pointer = idx >= 0 ? idx + 1 : pointer;
    }
    overrideBib = null;
  }

  if (!chosen) {
    if (pointer >= queue.length) {
      chosen = queue[queue.length - 1];
    } else {
      chosen = queue[pointer];
      pointer += 1;
    }
  }

  await setNextPointer(event.id, pointer);
  await updateEventConfig(event.id, { metadata: { ...metadata, overrideBib } });

  return { participant: chosen, queueLength: queue.length };
}

async function setOverrideBib(eventId, bibNumber) {
  const event = await getEventById(eventId);
  if (!event) return null;
  const metadata = { ...parseMetadata(event), overrideBib: bibNumber };
  await updateEventConfig(eventId, { metadata });
  return metadata;
}

module.exports = {
  buildQueue,
  determineParticipantForStart,
  setOverrideBib,
  sortParticipantsForQueue
};
