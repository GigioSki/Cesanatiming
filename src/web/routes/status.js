const express = require('express');

const { getGateStatus } = require('../../mqtt');

const router = express.Router();

router.get('/', (req, res) => {
  res.json(getGateStatus());
});

module.exports = router;
