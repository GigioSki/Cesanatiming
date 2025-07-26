const fs        = require('fs');
const path      = require('path');
const mqtt      = require('mqtt');
const express   = require('express');
const basicAuth = require('express-basic-auth');
const sqlite3   = require('sqlite3').verbose();

// --- Caricamento e validazione config.json ---
const CONFIG_FILE = path.join(__dirname, 'config', 'config.json');
if (!fs.existsSync(CONFIG_FILE)) {
  console.error('[FATAL] config/config.json non trovato in', __dirname);
  process.exit(1);
}
let config;
try {
  config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
} catch (err) {
  console.error('[FATAL] JSON malformato in config/config.json:', err.message);
  process.exit(1);
}
const timingPath       = config.database && config.database.timingPath;
const associationsPath = config.database && config.database.associationsPath;
if (!timingPath || !associationsPath) {
  console.error(
    '[FATAL] Devi specificare in config/config.json:\n' +
    '  "database": {\n' +
    '    "timingPath": "./data/timing.db",\n' +
    '    "associationsPath": "./data/associations.db"\n' +
    '  }'
  );
  process.exit(1);
}

// --- Creazione cartelle per i DB ---
[timingPath, associationsPath].forEach(p => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// --- Apertura DB separati ---
const timingDb = new sqlite3.Database(timingPath);
const assocDb = new sqlite3.Database(associationsPath);

// --- Inizializzo tabelle e allego assocdb ---
timingDb.serialize(() => {
  timingDb.run(`
    CREATE TABLE IF NOT EXISTS timings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tag_id TEXT NOT NULL DEFAULT 'Sconosciuto',
      start_time TEXT NOT NULL,
      elapsed_ms INTEGER NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  timingDb.run(
    `ATTACH DATABASE '${associationsPath}' AS assocdb`,
    err => {
      if (err) console.error('[ERROR] ATTACH assocdb:', err.message);
    }
  );
});

assocDb.serialize(() => {
  assocDb.run(`
    CREATE TABLE IF NOT EXISTS tags (
      uuid TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT
    )
  `);

  // Aggiorna schema esistente aggiungendo la colonna color se mancante
  assocDb.run(`ALTER TABLE tags ADD COLUMN color TEXT`, err => {
    if (err && !/duplicate column/.test(err.message)) {
      console.error('[ERROR] ALTER TABLE tags:', err.message);
    }
  });
});

// --- Stato gates e variabili temporanee cronometro ---
let statusStartGate = false;
let statusStopGate  = false;
let lastTagUUID     = null;
let lastStartRaw    = null;
let lastStartDate   = null;
let lastStartTag    = null;

// --- Client MQTT ---
const client = mqtt.connect(config.mqtt.brokerUrl, config.mqtt.options);
client.on('connect', () => {
  console.log('✓ MQTT connected');
  client.subscribe([
    config.mqtt.topicStatusStartGate,
    config.mqtt.topicStatusStopGate,
    config.mqtt.topicTag,
    config.mqtt.topicStart,
    config.mqtt.topicEnd
  ], err => {
    if (err) console.error('[ERROR] subscribe MQTT:', err.message);
  });
});
client.on('message', (topic, message) => {
  const payload = message.toString().trim().toLowerCase();

  if (topic === config.mqtt.topicStatusStartGate) {
    statusStartGate = payload === 'online';
    return;
  }
  if (topic === config.mqtt.topicStatusStopGate) {
    statusStopGate = payload === 'online';
    return;
  }
  if (topic === config.mqtt.topicTag) {
    lastTagUUID = message.toString().trim();
    return;
  }
  if (topic === config.mqtt.topicStart) {
    lastStartRaw = message.toString().trim();
    const [h,m,s,cs] = lastStartRaw.split(/[:.]/).map(Number);
    lastStartDate = new Date();
    lastStartDate.setHours(h,m,s,cs*10);
    lastStartTag = lastTagUUID || 'Sconosciuto';
    lastTagUUID = null;
    return;
  }
  if (topic === config.mqtt.topicEnd && lastStartDate) {
    const endRaw = message.toString().trim();
    const [h2,m2,s2,cs2] = endRaw.split(/[:.]/).map(Number);
    const endDate = new Date();
    endDate.setHours(h2,m2,s2,cs2*10);

    let elapsed = endDate - lastStartDate;
    if (elapsed < 0) elapsed += 24*3600*1000;

    timingDb.run(
      `INSERT INTO timings(tag_id,start_time,elapsed_ms) VALUES(?,?,?)`,
      [ lastStartTag, lastStartRaw, elapsed ],
      err => {
        if (err) console.error('[ERROR] insert timing:', err.message);
      }
    );

    lastStartRaw = lastStartDate = lastStartTag = null;
  }
});

// --- Express Web Server ---
const app = express();
app.use(express.json());

// Basic Auth per setup e API protette
const auth = basicAuth({
  users: { [config.web.username]: config.web.password },
  challenge: true
});
app.use((req, res, next) => {
  if (
    req.path === '/setup.html' ||
    req.path.startsWith('/api/tags') ||
    req.path.startsWith('/api/db')
  ) {
    return auth(req, res, next);
  }
  next();
});

// Log HTTP requests
app.use((req, res, next) => {
  console.log(`${req.method} ${req.url}`);
  next();
});

// Serve static files separati per HTML e CSS (timing.html di default)
app.use('/css', express.static(path.join(__dirname, 'css')));
app.use(express.static(path.join(__dirname, 'html')));

// Pagina principale
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'timing.html'));
});

// --- API: elenco cronometri con logica nome/UUID/Sconosciuto ---
app.get('/api/timings', (req, res) => {
  const sql = `
    SELECT
      t.tag_id,
      assocdb.tags.name   AS tag_name,
      assocdb.tags.color  AS tag_color,
      t.start_time,
      t.elapsed_ms,
      t.created_at
    FROM timings t
    LEFT JOIN assocdb.tags
      ON t.tag_id = assocdb.tags.uuid
    ORDER BY t.created_at DESC
  `;
  timingDb.all(sql, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });

    const bestByUuid = {};
    rows.forEach(r => {
      if (!bestByUuid[r.tag_id] || r.elapsed_ms < bestByUuid[r.tag_id]) {
        bestByUuid[r.tag_id] = r.elapsed_ms;
      }
    });

    const format = ms => {
      const pad = (n, z = 2) => ('00' + n).slice(-z);
      const h = Math.floor(ms / 3600000),
        m = Math.floor((ms % 3600000) / 60000),
        s = Math.floor((ms % 60000) / 1000),
        cs = Math.floor((ms % 1000) / 10);
      if (h > 0) {
        return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(cs)}`;
      }
      return `${m}:${pad(s)}.${pad(cs)}`;
    };

    res.json(
      rows.map(r => {
        let displayName;
        if (r.tag_name) {
          displayName = r.tag_name;
        } else if (r.tag_id && r.tag_id !== 'Sconosciuto') {
          displayName = r.tag_id;
        } else {
          displayName = 'Sconosciuto';
        }
        return {
          name: displayName,
          start_time: r.start_time,
          elapsed: format(r.elapsed_ms),
          created_at: r.created_at,
          color: r.tag_color,
          best: r.elapsed_ms === bestByUuid[r.tag_id]
        };
      })
    );
  });
});

// --- API Status Gate ---
app.get('/api/status', (req, res) => {
  res.json({ startGate: statusStartGate, stopGate: statusStopGate });
});

// --- API Tags CRUD ---
app.get('/api/tags', (req, res) => {
  assocDb.all(`SELECT uuid,name,color FROM tags`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});
app.post('/api/tags', (req, res) => {
  const { uuid, name, color } = req.body;
  assocDb.run(
    `INSERT OR REPLACE INTO tags(uuid,name,color) VALUES(?,?,?)`,
    [uuid.trim(), name.trim(), color || null],
    err => err
      ? res.status(500).json({ error: err.message })
      : res.sendStatus(200)
  );
});
app.delete('/api/tags/:uuid', (req, res) => {
  assocDb.run(
    `DELETE FROM tags WHERE uuid = ?`,
    req.params.uuid,
    err => err
      ? res.status(500).json({ error: err.message })
      : res.sendStatus(200)
  );
});

// --- API Unassigned UUIDs ---
app.get('/api/unassigned', (req, res) => {
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


// --- API Delete all TIMINGS ---
app.delete('/api/db/timings', (req, res) => {
  timingDb.run(`DELETE FROM timings`, err =>
    err ? res.status(500).json({ error: err.message }) : res.sendStatus(200)
  );
});

// --- API Delete all ASSOCIATIONS ---
app.delete('/api/db/associations', (req, res) => {
  assocDb.run(`DELETE FROM tags`, err =>
    err ? res.status(500).json({ error: err.message }) : res.sendStatus(200)
  );
});

// --- Avvio server ---
app.listen(config.web.port, config.web.host, () => {
  console.log(`🌐 Web server at http://${config.web.host}:${config.web.port}`);
});