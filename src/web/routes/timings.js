const express = require('express');

const { listTimings } = require('../../services/timingService');
const {
  getEventByCode,
  getEventBySlug
} = require('../../services/eventService');

const router = express.Router();

router.get('/', async (req, res) => {
  try {
    let eventId = null;
    if (req.query.eventId) {
      eventId = Number(req.query.eventId);
    } else if (req.query.eventCode) {
      const event = await getEventByCode(req.query.eventCode);
      eventId = event?.id || null;
    } else if (req.query.eventSlug) {
      const event = await getEventBySlug(req.query.eventSlug);
      eventId = event?.id || null;
    }
    const limit = req.query.limit ? Number(req.query.limit) : 100;
    const timings = await listTimings({ limit, eventId: eventId || undefined });
    res.json(timings);
  } catch (err) {
    console.error('[ERROR] /api/timings:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
