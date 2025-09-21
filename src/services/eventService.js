const { timingDb } = require('../db');

function run(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function get(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => {
      if (err) return reject(err);
      resolve(row);
    });
  });
}

function all(db, sql, params = []) {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function pad(num, size = 5) {
  return String(num).padStart(size, '0');
}

function buildCode(type, sequence) {
  const prefix = type === 'race' ? 'RACE' : 'TRAIN';
  return `${prefix}-${pad(sequence)}`;
}

function buildSlug(type, sequence) {
  const base = type === 'race' ? 'gara' : 'allenamento';
  return `${base}/${pad(sequence)}`;
}

function parseSlug(slug) {
  if (!slug) return null;
  const parts = slug.split('/');
  if (parts.length !== 2) return null;
  const [base, seq] = parts;
  const type = base === 'gara' ? 'race' : base === 'allenamento' ? 'training' : null;
  const sequence = Number(seq);
  if (!type || Number.isNaN(sequence)) return null;
  return { type, sequence };
}

async function getEventBySlug(slug) {
  const parsed = parseSlug(slug);
  if (!parsed) return null;
  const row = await get(
    timingDb,
    `SELECT * FROM events WHERE type = ? AND sequence = ?`,
    [parsed.type, parsed.sequence]
  );
  if (!row) return null;
  return { ...row, slug: buildSlug(row.type, row.sequence) };
}

async function getEventByCode(code) {
  if (!code) return null;
  const row = await get(timingDb, `SELECT * FROM events WHERE code = ?`, [code]);
  if (!row) return null;
  return { ...row, slug: buildSlug(row.type, row.sequence) };
}


async function nextSequence(type) {
  const row = await get(
    timingDb,
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM events WHERE type = ?`,
    [type]
  );
  return row?.seq || 1;
}

async function createEvent({ type, name }) {
  const sequence = await nextSequence(type);
  const code = buildCode(type, sequence);
  const now = new Date().toISOString();

  await run(timingDb, `UPDATE events SET is_active = 0 WHERE is_active = 1`);

  const result = await run(
    timingDb,
    `INSERT INTO events (code, sequence, type, name, status, is_active, start_mode, start_order, created_at, updated_at, started_at)
     VALUES (?, ?, ?, ?, 'active', 1, 'bracelet', 'normal', ?, ?, ?)` ,
    [code, sequence, type, name || null, now, now, now]
  );

  const eventId = result.lastID;

  if (type === 'race') {
    await run(
      timingDb,
      `INSERT INTO heats (event_id, name, sequence) VALUES (?, ?, 1)` ,
      [eventId, 'Manche 1']
    );
    await run(
      timingDb,
      `UPDATE events SET current_heat_id = (SELECT id FROM heats WHERE event_id = ? AND sequence = 1) WHERE id = ?`,
      [eventId, eventId]
    );
  }

  const event = await get(timingDb, `SELECT * FROM events WHERE id = ?`, [eventId]);
  return {
    ...event,
    slug: buildSlug(type, sequence)
  };
}

async function listEvents() {
  const rows = await all(
    timingDb,
    `SELECT e.*, 
            (SELECT COUNT(*) FROM timings t WHERE t.event_id = e.id) AS timings_count,
            (SELECT COUNT(*) FROM participants p WHERE p.event_id = e.id) AS participants_count
     FROM events e
     ORDER BY e.created_at DESC`
  );
  return rows.map(r => ({ ...r, slug: buildSlug(r.type, r.sequence) }));
}

async function getEventById(id) {
  const event = await get(timingDb, `SELECT * FROM events WHERE id = ?`, [id]);
  if (!event) return null;
  const timingsCountRow = await get(
    timingDb,
    `SELECT COUNT(*) AS count FROM timings WHERE event_id = ?`,
    [id]
  );
  const participantsCountRow = await get(
    timingDb,
    `SELECT COUNT(*) AS count FROM participants WHERE event_id = ?`,
    [id]
  );
  return {
    ...event,
    slug: buildSlug(event.type, event.sequence),
    timings_count: timingsCountRow?.count || 0,
    participants_count: participantsCountRow?.count || 0
  };
}

async function getActiveEvent() {
  const row = await get(timingDb, `SELECT * FROM events WHERE is_active = 1 LIMIT 1`);
  if (!row) return null;
  return {
    ...row,
    slug: buildSlug(row.type, row.sequence)
  };
}

async function setActiveEvent(id) {
  const now = new Date().toISOString();
  await run(timingDb, `UPDATE events SET is_active = 0 WHERE is_active = 1`);
  await run(
    timingDb,
    `UPDATE events SET is_active = 1, status = 'active', updated_at = ?, started_at = COALESCE(started_at, ?) WHERE id = ?`,
    [now, now, id]
  );
  return getEventById(id);
}

async function closeEvent(id) {
  const now = new Date().toISOString();
  await run(
    timingDb,
    `UPDATE events SET is_active = 0, status = 'completed', updated_at = ?, ended_at = ? WHERE id = ?`,
    [now, now, id]
  );
  return getEventById(id);
}

async function updateEventConfig(id, config) {
  const fields = [];
  const params = [];
  if (config.start_mode !== undefined) {
    fields.push('start_mode = ?');
    params.push(config.start_mode);
  }
  if (config.start_order !== undefined) {
    fields.push('start_order = ?');
    params.push(config.start_order);
  }
  if (config.current_heat_id !== undefined) {
    fields.push('current_heat_id = ?');
    params.push(config.current_heat_id || null);
  }
  if (config.metadata !== undefined) {
    fields.push('metadata = ?');
    params.push(JSON.stringify(config.metadata));
  }
  if (!fields.length) return getEventById(id);
  fields.push('updated_at = ?');
  params.push(new Date().toISOString());
  params.push(id);
  await run(
    timingDb,
    `UPDATE events SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  return getEventById(id);
}

async function getHeatById(id) {
  if (!id) return null;
  return get(
    timingDb,
    `SELECT * FROM heats WHERE id = ?`,
    [id]
  );
}

async function listHeats(eventId) {
  const heats = await all(
    timingDb,
    `SELECT * FROM heats WHERE event_id = ? ORDER BY sequence ASC`,
    [eventId]
  );
  return heats;
}

async function addHeat(eventId, name) {
  const row = await get(
    timingDb,
    `SELECT COALESCE(MAX(sequence), 0) + 1 AS seq FROM heats WHERE event_id = ?`,
    [eventId]
  );
  const seq = row?.seq || 1;
  const result = await run(
    timingDb,
    `INSERT INTO heats (event_id, name, sequence) VALUES (?, ?, ?)` ,
    [eventId, name || `Manche ${seq}`, seq]
  );
  return get(timingDb, `SELECT * FROM heats WHERE id = ?`, [result.lastID]);
}

async function getParticipantByTag(eventId, tagUuid) {
  if (!tagUuid) return null;
  return get(
    timingDb,
    `SELECT * FROM participants WHERE event_id = ? AND tag_uuid = ?`,
    [eventId, tagUuid]
  );
}

async function getParticipantByBib(eventId, bibNumber) {
  return get(
    timingDb,
    `SELECT * FROM participants WHERE event_id = ? AND bib_number = ?`,
    [eventId, bibNumber]
  );
}

async function listParticipants(eventId) {
  return all(
    timingDb,
    `SELECT * FROM participants WHERE event_id = ? ORDER BY (bib_number IS NULL), bib_number ASC`,
    [eventId]
  );
}

async function upsertParticipant(eventId, bibNumber, name, tagUuid) {
  const now = new Date().toISOString();
  await run(
    timingDb,
    `INSERT INTO participants(event_id, bib_number, name, tag_uuid, created_at, updated_at)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(event_id, bib_number) DO UPDATE SET name = excluded.name, tag_uuid = excluded.tag_uuid, updated_at = excluded.updated_at`,
    [eventId, bibNumber, name || null, tagUuid || null, now, now]
  );
}

async function removeParticipant(eventId, bibNumber) {
  await run(
    timingDb,
    `DELETE FROM participants WHERE event_id = ? AND bib_number = ?`,
    [eventId, bibNumber]
  );
}

async function resetParticipants(eventId, total, includeForerunner = true) {
  await run(timingDb, `DELETE FROM participants WHERE event_id = ?`, [eventId]);
  const now = new Date().toISOString();
  const statements = [];
  if (includeForerunner) {
    statements.push(run(timingDb, `INSERT INTO participants(event_id, bib_number, name, created_at, updated_at) VALUES(?,?,?,?,?)`, [eventId, 0, 'Apripista', now, now]));
  }
  for (let i = 1; i <= total; i += 1) {
    statements.push(run(timingDb, `INSERT INTO participants(event_id, bib_number, created_at, updated_at) VALUES(?,?,?,?)`, [eventId, i, now, now]));
  }
  await Promise.all(statements);
  await setNextPointer(eventId, 0);
}

function parseMetadata(event) {
  if (!event || !event.metadata) return {};
  try {
    return JSON.parse(event.metadata);
  } catch {
    return {};
  }
}

async function setNextPointer(eventId, pointer) {
  await run(
    timingDb,
    `UPDATE events SET next_pointer = ?, updated_at = ? WHERE id = ?`,
    [pointer, new Date().toISOString(), eventId]
  );
}

module.exports = {
  createEvent,
  listEvents,
  getEventById,
  getActiveEvent,
  setActiveEvent,
  closeEvent,
  updateEventConfig,
  listHeats,
  getHeatById,
  addHeat,
  listParticipants,
  getParticipantByTag,
  getParticipantByBib,
  upsertParticipant,
  removeParticipant,
  resetParticipants,
  buildSlug,
  getEventBySlug,
  getEventByCode,
  parseSlug,
  parseMetadata,
  setNextPointer
};
