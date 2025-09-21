const fs   = require('fs');
const path = require('path');

const CONFIG_FILE = path.join(__dirname, '..', '..', 'config', 'config.json');

function loadConfig() {
  if (!fs.existsSync(CONFIG_FILE)) {
    console.error('[FATAL] config/config.json non trovato in', CONFIG_FILE);
    process.exit(1);
  }

  try {
    const raw = fs.readFileSync(CONFIG_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    const timingPath = parsed?.database?.timingPath;
    const associationsPath = parsed?.database?.associationsPath;

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

    return parsed;
  } catch (err) {
    console.error('[FATAL] JSON malformato in config/config.json:', err.message);
    process.exit(1);
  }
}

module.exports = {
  loadConfig
};
