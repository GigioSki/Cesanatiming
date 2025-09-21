const express = require('express');

const { assocDb } = require('../../db');

const router = express.Router();

router.get('/', (req, res) => {
  assocDb.all(`SELECT uuid,name,color FROM tags`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

router.post('/', (req, res) => {
  const { uuid, name, color } = req.body;
  if (!uuid || !name) {
    return res.status(400).json({ error: 'uuid e name sono obbligatori' });
  }
  assocDb.run(
    `INSERT OR REPLACE INTO tags(uuid,name,color) VALUES(?,?,?)`,
    [uuid.trim(), name.trim(), color || null],
    err => (err ? res.status(500).json({ error: err.message }) : res.sendStatus(200))
  );
});

router.delete('/:uuid', (req, res) => {
  assocDb.run(
    `DELETE FROM tags WHERE uuid = ?`,
    req.params.uuid,
    err => (err ? res.status(500).json({ error: err.message }) : res.sendStatus(200))
  );
});

module.exports = router;
