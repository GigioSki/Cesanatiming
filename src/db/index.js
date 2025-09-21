const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const { loadConfig } = require('../config');

const config = loadConfig();
const timingPath = config.database.timingPath;
const associationsPath = config.database.associationsPath;

[timingPath, associationsPath].forEach(p => {
  const dir = path.dirname(p);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

const timingDb = new sqlite3.Database(timingPath);
const assocDb = new sqlite3.Database(associationsPath);

function addColumn(db, table, columnDef) {
  const name = columnDef.trim().split(/\s+/, 1)[0];
  db.run(`ALTER TABLE ${table} ADD COLUMN ${columnDef}`.trim(), err => {
    if (err && !/duplicate column/.test(err.message)) {
      console.error(`[ERROR] ALTER TABLE ${table} ADD COLUMN ${name}:`, err.message);
    }
  });
}

function initializeTimingDb() {
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

    addColumn(timingDb, 'timings', 'event_id INTEGER');
    addColumn(timingDb, 'timings', 'participant_id INTEGER');
    addColumn(timingDb, 'timings', 'bib_number INTEGER');
    addColumn(timingDb, 'timings', 'heat_id INTEGER');
    addColumn(timingDb, 'timings', 'heat_name TEXT');
    addColumn(timingDb, 'timings', 'lap INTEGER DEFAULT 1');

    timingDb.run(`
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        sequence INTEGER NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('training','race')),
        name TEXT,
        status TEXT NOT NULL DEFAULT 'draft',
        is_active INTEGER NOT NULL DEFAULT 0,
        start_mode TEXT,
        start_order TEXT DEFAULT 'normal',
        next_pointer INTEGER DEFAULT 0,
        current_heat_id INTEGER,
        metadata TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        started_at DATETIME,
        ended_at DATETIME
      )
    `);

    addColumn(timingDb, 'events', 'sequence INTEGER NOT NULL DEFAULT 0');
    addColumn(timingDb, 'events', 'next_pointer INTEGER DEFAULT 0');

    timingDb.run(`
      CREATE TABLE IF NOT EXISTS participants (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        bib_number INTEGER,
        name TEXT,
        tag_uuid TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, bib_number),
        FOREIGN KEY(event_id) REFERENCES events(id)
      )
    `);

    timingDb.run(`
      CREATE TABLE IF NOT EXISTS heats (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        event_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sequence INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(event_id, sequence),
        FOREIGN KEY(event_id) REFERENCES events(id)
      )
    `);

    timingDb.run(
      `ATTACH DATABASE '${associationsPath}' AS assocdb`,
      err => {
        if (err) {
          console.error('[ERROR] ATTACH assocdb:', err.message);
        }
      }
    );
  });
}

function initializeAssocDb() {
  assocDb.serialize(() => {
    assocDb.run(`
      CREATE TABLE IF NOT EXISTS tags (
        uuid TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        color TEXT
      )
    `);

    assocDb.run(`ALTER TABLE tags ADD COLUMN color TEXT`, err => {
      if (err && !/duplicate column/.test(err.message)) {
        console.error('[ERROR] ALTER TABLE tags:', err.message);
      }
    });
  });
}

initializeTimingDb();
initializeAssocDb();

module.exports = {
  timingDb,
  assocDb,
  config
};
