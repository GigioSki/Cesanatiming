const express = require('express');

const {
  createEvent,
  listEvents,
  getEventById,
  getEventBySlug,
  getEventByCode,
  setActiveEvent,
  closeEvent,
  updateEventConfig,
  listHeats,
  addHeat,
  listParticipants,
  getParticipantByBib,
  upsertParticipant,
  removeParticipant,
  resetParticipants,
  setNextPointer,
  updateEventName,
  renameHeat,
  deleteEvent
} = require('../../services/eventService');
const { setOverrideBib } = require('../../services/raceLogic');
const { listRawTimings, recordTiming, formatMs } = require('../../services/timingService');

const router = express.Router();

function toCsvRow(values) {
  return values.map(v => {
    if (v === null || v === undefined) return '';
    const value = String(v).replace(/"/g, '""');
    return `"${value}"`;
  }).join(',');
}

function parseElapsedToMs(value) {
  if (typeof value === 'number' && !Number.isNaN(value)) return value;
  if (!value) return null;
  const parts = value.split(/[:.]/).map(Number);
  if (parts.length === 4) {
    const [h, m, s, cs] = parts;
    return ((h || 0) * 3600 + (m || 0) * 60 + (s || 0)) * 1000 + (cs || 0) * 10;
  }
  if (parts.length === 3) {
    const [m, s, cs] = parts;
    return ((m || 0) * 60 + (s || 0)) * 1000 + (cs || 0) * 10;
  }
  return Number(value) || null;
}

router.get('/lookup', async (req, res) => {
  try {
    if (req.query.slug) {
      const event = await getEventBySlug(req.query.slug);
      if (!event) return res.status(404).json({ error: 'Evento non trovato' });
      return res.json(event);
    }
    if (req.query.code) {
      const event = await getEventByCode(req.query.code);
      if (!event) return res.status(404).json({ error: 'Evento non trovato' });
      return res.json(event);
    }
    return res.status(400).json({ error: 'Parametro slug o code richiesto' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const events = await listEvents();
    res.json(events);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { type, name } = req.body;
    if (!type) {
      return res.status(400).json({ error: 'type richiesto' });
    }
    const event = await createEvent({ type, name });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id', async (req, res) => {
  try {
    const { name } = req.body;
    const event = await updateEventName(Number(req.params.id), name);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const event = await getEventById(Number(req.params.id));
    if (!event) return res.status(404).json({ error: 'Evento non trovato' });
    const heats = await listHeats(event.id);
    const participants = await listParticipants(event.id);
    res.json({ event, heats, participants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/activate', async (req, res) => {
  try {
    const event = await setActiveEvent(Number(req.params.id));
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/close', async (req, res) => {
  try {
    const event = await closeEvent(Number(req.params.id));
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/config', async (req, res) => {
  try {
    const payload = {};
    if (req.body.start_mode) payload.start_mode = req.body.start_mode;
    if (req.body.start_order) payload.start_order = req.body.start_order;
    if (Object.prototype.hasOwnProperty.call(req.body, 'current_heat_id')) {
      payload.current_heat_id = req.body.current_heat_id;
    }
    if (!Object.keys(payload).length) {
      return res.status(400).json({ error: 'Nessuna proprietà da aggiornare' });
    }
    const event = await updateEventConfig(Number(req.params.id), payload);
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/heats', async (req, res) => {
  try {
    const heats = await listHeats(Number(req.params.id));
    res.json(heats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/heats', async (req, res) => {
  try {
    const heat = await addHeat(Number(req.params.id), req.body.name);
    res.status(201).json(heat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.patch('/:id/heats/:heatId', async (req, res) => {
  try {
    const heat = await renameHeat(Number(req.params.id), Number(req.params.heatId), req.body.name);
    res.json(heat);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/export/participants', async (req, res) => {
  try {
    const participants = await listParticipants(Number(req.params.id));
    const header = toCsvRow(['bib_number', 'name', 'tag_uuid']);
    const rows = participants.map(p => toCsvRow([p.bib_number, p.name || '', p.tag_uuid || '']));
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="participants.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/export/timings', async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const [timings, participants] = await Promise.all([
      listRawTimings(eventId),
      listParticipants(eventId)
    ]);
    const participantById = new Map(participants.map(p => [p.id, p]));
    const header = toCsvRow(['bib_number', 'name', 'tag_id', 'elapsed_ms', 'elapsed_text', 'status', 'start_time']);
    const rows = timings.map(t => {
      const participant = t.participant_id ? participantById.get(t.participant_id) : null;
      const bib = participant?.bib_number ?? t.bib_number ?? '';
      const name = participant?.name || '';
      const tag = participant?.tag_uuid || t.tag_id || '';
      const elapsedText = t.status === 'dnf' ? 'DNF' : formatMs(t.elapsed_ms);
      return toCsvRow([bib, name, tag, t.elapsed_ms, elapsedText, t.status, t.start_time]);
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="timings.csv"');
    res.send([header, ...rows].join('\n'));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/import/participants', async (req, res) => {
  try {
    const items = Array.isArray(req.body.participants) ? req.body.participants : null;
    if (!items) {
      return res.status(400).json({ error: 'participants deve essere un array' });
    }
    const eventId = Number(req.params.id);
    for (const item of items) {
      const bib = item.bibNumber != null ? Number(item.bibNumber) : null;
      await upsertParticipant(eventId, bib, item.name, item.tagUuid);
    }
    const participants = await listParticipants(eventId);
    res.json({ imported: items.length, participants });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/import/timings', async (req, res) => {
  try {
    const items = Array.isArray(req.body.timings) ? req.body.timings : null;
    if (!items) {
      return res.status(400).json({ error: 'timings deve essere un array' });
    }
    const eventId = Number(req.params.id);
    let imported = 0;
    for (const item of items) {
      const elapsed = parseElapsedToMs(item.elapsedMs ?? item.elapsed ?? item.time);
      if (!elapsed) continue;
      await recordTiming({
        tagId: item.tagId || item.tag_uuid || 'Sconosciuto',
        startTime: item.startTime || item.start_time || '',
        elapsedMs: elapsed,
        eventId,
        participantId: null,
        bibNumber: item.bibNumber != null ? Number(item.bibNumber) : null
      });
      imported += 1;
    }
    res.json({ imported });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id/participants', async (req, res) => {
  try {
    const participants = await listParticipants(Number(req.params.id));
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/participants/reset', async (req, res) => {
  try {
    const total = Number(req.body.total || 0);
    const includeForerunner = req.body.includeForerunner !== false;
    await resetParticipants(Number(req.params.id), total, includeForerunner);
    const participants = await listParticipants(Number(req.params.id));
    res.json(participants);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/participants', async (req, res) => {
  try {
    const eventId = Number(req.params.id);
    const bibNumber = req.body.bibNumber != null ? Number(req.body.bibNumber) : null;
    await upsertParticipant(eventId, bibNumber, req.body.name, req.body.tagUuid);
    const participant = bibNumber != null
      ? await getParticipantByBib(eventId, bibNumber)
      : null;
    res.json(participant);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id/participants/:bib', async (req, res) => {
  try {
    await removeParticipant(Number(req.params.id), Number(req.params.bib));
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pointer', async (req, res) => {
  try {
    const pointer = Number(req.body.pointer || 0);
    await setNextPointer(Number(req.params.id), pointer);
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/override', async (req, res) => {
  try {
    const raw = req.body.bibNumber;
    const bib = raw === undefined || raw === null || raw === '' ? null : Number(raw);
    const metadata = await setOverrideBib(Number(req.params.id), bib);
    res.json(metadata);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    await deleteEvent(Number(req.params.id));
    res.sendStatus(204);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
