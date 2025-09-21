const express = require('express');

const { timingDb, assocDb } = require('../../db');

const router = express.Router();

router.delete('/timings', (req, res) => {
  timingDb.run(`DELETE FROM timings`, err =>
    err ? res.status(500).json({ error: err.message }) : res.sendStatus(200)
  );
});

router.delete('/associations', (req, res) => {
  assocDb.run(`DELETE FROM tags`, err =>
    err ? res.status(500).json({ error: err.message }) : res.sendStatus(200)
  );
});

module.exports = router;
