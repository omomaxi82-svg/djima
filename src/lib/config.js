const fs = require('fs');
const path = require('path');
const paths = require('./paths');
const { readJson, writeJson, ensureSeeded } = require('./jsonStore');

ensureSeeded(paths.RUNTIME_CONFIG_PATH, paths.DEFAULT_CONFIG_PATH);

let cache = readJson(paths.RUNTIME_CONFIG_PATH, {});

function resolvePath(p) {
  return path.isAbsolute(p) ? p : path.join(paths.ROOT, p);
}

function get() {
  return cache;
}

function getResolvedDirs() {
  return {
    inputDir: resolvePath(cache.inputDir),
    outputDir: resolvePath(cache.outputDir),
    quarantineDir: resolvePath(cache.quarantineDir)
  };
}

function ensureDirsExist() {
  const dirs = getResolvedDirs();
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));
}

function update(patch) {
  cache = { ...cache, ...patch };
  writeJson(paths.RUNTIME_CONFIG_PATH, cache);
  ensureDirsExist();
  return cache;
}

ensureDirsExist();

module.exports = { get, update, getResolvedDirs, ensureDirsExist };
