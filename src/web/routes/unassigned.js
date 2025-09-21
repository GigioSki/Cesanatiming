const express = require('express');

const { timingDb } = require('../../db');

const router = express.Router();

router.get('/', (req, res) => {
  const sql = `
    SELECT DISTINCT t.tag_id FROM timings t
    LEFT JOIN assocdb.tags ON t.tag_id = assocdb.tags.uuid
    WHERE assocdb.tags.uuid IS NULL AND t.tag_id != 'Sconosciuto'
    ORDER BY t.tag_id
  `;
  timingDb.all(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows.map(r => r.tag_id));
  });
});

module.exports = router;
