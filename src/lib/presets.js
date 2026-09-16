const crypto = require('crypto');
const paths = require('./paths');
const { readJson, writeJson, ensureSeeded } = require('./jsonStore');

ensureSeeded(paths.RUNTIME_PRESETS_PATH, paths.DEFAULT_PRESETS_PATH);

let cache = readJson(paths.RUNTIME_PRESETS_PATH, []);

function persist() {
  writeJson(paths.RUNTIME_PRESETS_PATH, cache);
}

function list() {
  return cache;
}

function getById(id) {
  return cache.find((p) => p.id === id);
}

function create(preset) {
  const id = preset.id || `custom_${crypto.randomBytes(4).toString('hex')}`;
  if (getById(id)) throw new Error(`Un preset avec l'id "${id}" existe deja`);
  const entry = {
    id,
    label: preset.label || id,
    category: preset.category || 'Autres',
    extension: preset.extension || 'mp4',
    description: preset.description || '',
    recommendedForCynergie: !!preset.recommendedForCynergie,
    args: Array.isArray(preset.args) ? preset.args : [],
    custom: true
  };
  cache.push(entry);
  persist();
  return entry;
}

function update(id, patch) {
  const idx = cache.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Preset introuvable: ${id}`);
  cache[idx] = { ...cache[idx], ...patch, id };
  persist();
  return cache[idx];
}

function remove(id) {
  const idx = cache.findIndex((p) => p.id === id);
  if (idx === -1) throw new Error(`Preset introuvable: ${id}`);
  cache.splice(idx, 1);
  persist();
}

module.exports = { list, getById, create, update, remove };
