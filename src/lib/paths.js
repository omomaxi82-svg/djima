const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const DATA_DIR = path.join(ROOT, 'data');
const RUNTIME_CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const RUNTIME_PRESETS_PATH = path.join(DATA_DIR, 'presets.json');
const JOBS_DB_PATH = path.join(DATA_DIR, 'jobs.json');
const DEFAULT_CONFIG_PATH = path.join(ROOT, 'config', 'config.example.json');
const DEFAULT_PRESETS_PATH = path.join(ROOT, 'config', 'presets.default.json');

module.exports = {
  ROOT,
  DATA_DIR,
  RUNTIME_CONFIG_PATH,
  RUNTIME_PRESETS_PATH,
  JOBS_DB_PATH,
  DEFAULT_CONFIG_PATH,
  DEFAULT_PRESETS_PATH
};
