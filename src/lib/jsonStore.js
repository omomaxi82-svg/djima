const fs = require('fs');
const path = require('path');

// Petit magasin JSON synchrone : suffisant pour un outil interne mono-instance
// (volumes de jobs faibles), evite toute dependance native a compiler sur
// des serveurs de diffusion aux moyens limites.

function ensureDir(filePath) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
}

function readJson(filePath, fallback) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
  } catch (err) {
    if (err.code === 'ENOENT') return fallback;
    throw err;
  }
}

function writeJson(filePath, data) {
  ensureDir(filePath);
  const tmpPath = `${filePath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

function ensureSeeded(filePath, seedPath) {
  if (!fs.existsSync(filePath)) {
    ensureDir(filePath);
    fs.copyFileSync(seedPath, filePath);
  }
}

module.exports = { readJson, writeJson, ensureSeeded, ensureDir };
