const express = require('express');
const path = require('path');
const config = require('../lib/config');
const presets = require('../lib/presets');
const watcher = require('../lib/watcher');
const jobs = require('../lib/jobs');
const ffmpeg = require('../lib/ffmpeg');

const router = express.Router();

function isKnownInputFile(filePath) {
  return watcher.files.has(filePath);
}

router.get('/status', async (req, res) => {
  const binaries = await ffmpeg.checkBinaries();
  const dirs = config.getResolvedDirs();
  res.json({
    binaries,
    dirs,
    fileCount: watcher.list().length,
    activeJobs: jobs.list().filter((j) => !['termine', 'echec', 'a_verifier'].includes(j.status)).length
  });
});

router.get('/config', (req, res) => {
  const cfg = { ...config.get() };
  if (cfg.auth) cfg.auth = { ...cfg.auth, password: cfg.auth.password ? '********' : '' };
  res.json(cfg);
});

router.put('/config', (req, res) => {
  const patch = { ...req.body };
  const current = config.get();
  // Ne pas ecraser le mot de passe si le client renvoie la valeur masquee
  if (patch.auth && patch.auth.password === '********') {
    patch.auth = { ...patch.auth, password: current.auth.password };
  }
  const updated = config.update(patch);
  watcher.start();
  res.json(updated);
});

router.get('/presets', (req, res) => {
  res.json(presets.list());
});

router.post('/presets', (req, res) => {
  try {
    res.status(201).json(presets.create(req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/presets/:id', (req, res) => {
  try {
    res.json(presets.update(req.params.id, req.body));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/presets/:id', (req, res) => {
  try {
    presets.remove(req.params.id);
    res.status(204).end();
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/files', (req, res) => {
  res.json(watcher.list());
});

router.post('/files/analyze', async (req, res) => {
  const { path: filePath } = req.body;
  if (!filePath || !isKnownInputFile(filePath)) {
    return res.status(400).json({ error: 'Fichier inconnu du dossier d\'entree' });
  }
  const cfg = config.get();
  const result = await ffmpeg.healthCheck(filePath, cfg.blackdetect);
  res.json(result);
});

router.get('/jobs', (req, res) => {
  res.json(jobs.list());
});

router.get('/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Job introuvable' });
  res.json(job);
});

router.post('/jobs', (req, res) => {
  const { files, presetId } = req.body;
  const list = Array.isArray(files) ? files : [files];
  const created = [];
  for (const filePath of list) {
    if (!filePath || !isKnownInputFile(filePath)) {
      return res.status(400).json({ error: `Fichier inconnu du dossier d'entree: ${filePath}` });
    }
    if (!presets.getById(presetId)) {
      return res.status(400).json({ error: `Preset inconnu: ${presetId}` });
    }
  }
  for (const filePath of list) {
    created.push(jobs.enqueue(filePath, presetId));
  }
  res.status(201).json(created);
});

module.exports = router;
