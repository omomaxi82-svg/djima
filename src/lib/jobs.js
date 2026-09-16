const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const EventEmitter = require('events');
const paths = require('./paths');
const { readJson, writeJson } = require('./jsonStore');
const config = require('./config');
const presets = require('./presets');
const ffmpeg = require('./ffmpeg');

const MAX_HISTORY = 300;

class JobManager extends EventEmitter {
  constructor() {
    super();
    this.jobs = readJson(paths.JOBS_DB_PATH, []);
    this.running = new Set();
  }

  persist() {
    // On ne garde que les N derniers jobs pour ne pas faire grossir le fichier indefiniment
    const trimmed = this.jobs.slice(-MAX_HISTORY);
    this.jobs = trimmed;
    writeJson(paths.JOBS_DB_PATH, this.jobs);
  }

  list() {
    return [...this.jobs].reverse();
  }

  get(id) {
    return this.jobs.find((j) => j.id === id);
  }

  emitUpdate(job) {
    this.persist();
    this.emit('update', job);
  }

  enqueue(inputFile, presetId) {
    const preset = presets.getById(presetId);
    if (!preset) throw new Error(`Preset inconnu: ${presetId}`);

    const job = {
      id: crypto.randomBytes(6).toString('hex'),
      inputFile,
      inputBaseName: path.basename(inputFile),
      presetId,
      presetLabel: preset.label,
      status: 'en_attente',
      progress: { percent: null, speed: null, fps: null },
      createdAt: new Date().toISOString(),
      startedAt: null,
      finishedAt: null,
      outputFile: null,
      healthBefore: null,
      healthAfter: null,
      issues: [],
      error: null,
      logTail: ''
    };
    this.jobs.push(job);
    this.emitUpdate(job);
    this.pump();
    return job;
  }

  pump() {
    const cfg = config.get();
    const concurrency = cfg.concurrency || 2;
    if (this.running.size >= concurrency) return;

    const next = this.jobs.find((j) => j.status === 'en_attente');
    if (!next) return;

    this.running.add(next.id);
    this.processJob(next).finally(() => {
      this.running.delete(next.id);
      this.pump();
    });

    // Laisse la place a plusieurs jobs concurrents jusqu'a la limite
    if (this.running.size < concurrency) this.pump();
  }

  async processJob(job) {
    const cfg = config.get();
    const dirs = config.getResolvedDirs();
    const preset = presets.getById(job.presetId);

    try {
      job.status = 'analyse';
      job.startedAt = new Date().toISOString();
      this.emitUpdate(job);

      const before = await ffmpeg.healthCheck(job.inputFile, cfg.blackdetect);
      job.healthBefore = before;
      if (before.status === 'corrompu') {
        job.status = 'echec';
        job.error = 'Fichier source illisible ou corrompu : impossible a transcoder automatiquement.';
        job.finishedAt = new Date().toISOString();
        this.emitUpdate(job);
        return;
      }

      job.status = 'transcodage';
      this.emitUpdate(job);

      const outputFile = ffmpeg.buildOutputPath(job.inputFile, preset, dirs.outputDir);
      const durationSec = (before.probe && before.probe.duration) || 0;

      const result = await ffmpeg.transcode(job.inputFile, outputFile, preset, {
        durationSec,
        onProgress: (p) => {
          job.progress = p;
          this.emit('progress', job);
        },
        onLog: (text) => {
          job.logTail = (job.logTail + text).slice(-4000);
        }
      });

      if (!result.success) {
        job.status = 'echec';
        job.error = `Echec ffmpeg (code ${result.code}) : ${result.stderr.slice(-500)}`;
        job.finishedAt = new Date().toISOString();
        this.emitUpdate(job);
        return;
      }

      job.status = 'verification';
      this.emitUpdate(job);

      const after = await ffmpeg.healthCheck(outputFile, cfg.blackdetect);
      job.healthAfter = after;

      if (after.status === 'ok') {
        job.outputFile = outputFile;
        job.status = 'termine';
      } else {
        // Ne jamais livrer silencieusement un fichier douteux dans le dossier de playout :
        // on le deplace en quarantaine pour verification manuelle.
        const quarantinePath = path.join(dirs.quarantineDir, path.basename(outputFile));
        fs.mkdirSync(dirs.quarantineDir, { recursive: true });
        fs.renameSync(outputFile, quarantinePath);
        job.outputFile = quarantinePath;
        job.status = 'a_verifier';
        job.issues = after.issues;
      }
      job.finishedAt = new Date().toISOString();
      this.emitUpdate(job);
    } catch (err) {
      job.status = 'echec';
      job.error = err.message;
      job.finishedAt = new Date().toISOString();
      this.emitUpdate(job);
    }
  }
}

module.exports = new JobManager();
