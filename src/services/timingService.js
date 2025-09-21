const { timingDb } = require('../db');

function run(sql, params = []) {
  return new Promise((resolve, reject) => {
    timingDb.run(sql, params, function (err) {
      if (err) return reject(err);
      resolve(this);
    });
  });
}

function all(sql, params = []) {
  return new Promise((resolve, reject) => {
    timingDb.all(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

function formatMs(ms) {
  const pad = (n, z = 2) => ('00' + n).slice(-z);
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const cs = Math.floor((ms % 1000) / 10);
  if (h > 0) {
    return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
  }
  return `${m}:${pad(s)}.${pad(cs)}`;
}

async function recordTiming({
  tagId,
  startTime,
  elapsedMs,
  eventId = null,
  participantId = null,
  bibNumber = null,
  heatId = null,
  heatName = null,
  lap = 1,
  status = 'completed'
}) {
  await run(
    `INSERT INTO timings(tag_id, start_time, elapsed_ms, event_id, participant_id, bib_number, heat_id, heat_name, lap, status)
     VALUES(?,?,?,?,?,?,?,?,?,?)`,
    [
      tagId || 'Sconosciuto',
      startTime,
      elapsedMs,
      eventId,
      participantId,
      bibNumber,
      heatId,
      heatName,
      lap,
      status
    ]
  );
}

async function listTimings({ limit = 100, eventId = null } = {}) {
  const params = [];
  let where = '';
  if (eventId) {
    where = 'WHERE t.event_id = ?';
    params.push(eventId);
  }
  const rows = await all(
    `SELECT
       t.id,
       t.tag_id,
       t.start_time,
       t.elapsed_ms,
       t.created_at,
       t.event_id,
       t.participant_id,
       t.bib_number,
       t.heat_id,
       t.heat_name,
       t.status,
       assocdb.tags.name  AS tag_name,
       assocdb.tags.color AS tag_color,
       participant.name  AS participant_name,
       bib_participant.name AS bib_participant_name
     FROM timings t
     LEFT JOIN assocdb.tags ON t.tag_id = assocdb.tags.uuid
     LEFT JOIN participants AS participant ON t.participant_id = participant.id
     LEFT JOIN participants AS bib_participant
       ON bib_participant.event_id = t.event_id AND bib_participant.bib_number = t.bib_number
     ${where}
     ORDER BY t.created_at DESC
     LIMIT ?`,
    [...params, limit]
  );

  const bestByUuid = {};
  rows.forEach(r => {
    if (r.status === 'dnf') return;
    const key = r.tag_id || `bib:${r.bib_number || ''}`;
    if (!bestByUuid[key] || r.elapsed_ms < bestByUuid[key]) {
      bestByUuid[key] = r.elapsed_ms;
    }
  });

  

  return rows.map(r => {
    let displayName;
    const participantName = r.participant_name || r.bib_participant_name;
    if (participantName) {
      displayName = participantName;
    } else if (r.tag_name) {
      displayName = r.tag_name;
    } else if (r.bib_number != null) {
      displayName = `Pettorale ${r.bib_number}`;
    } else if (r.tag_id && r.tag_id !== 'Sconosciuto') {
      displayName = r.tag_id;
    } else {
      displayName = 'Sconosciuto';
    }
    const key = r.tag_id || `bib:${r.bib_number || ''}`;
    const isDnf = r.status === 'dnf';
    return {
      id: r.id,
      name: displayName,
      start_time: r.start_time,
      elapsed: isDnf ? 'DNF' : formatMs(r.elapsed_ms),
      elapsed_ms: r.elapsed_ms,
      created_at: r.created_at,
      color: r.tag_color,
      best: !isDnf && bestByUuid[key] != null && r.elapsed_ms === bestByUuid[key],
      bib_number: r.bib_number,
      heat_name: r.heat_name,
      status: r.status
    };
  });
}

async function listRawTimings(eventId) {
  const rows = await all(
    `SELECT id, tag_id, start_time, elapsed_ms, created_at, event_id, participant_id, bib_number, heat_id, heat_name, status
     FROM timings
     WHERE event_id = ?
     ORDER BY created_at ASC`,
    [eventId]
  );
  return rows;
}

module.exports = {
  recordTiming,
  listTimings,
  listRawTimings,
  formatMs
};
