const http = require('http');
const path = require('path');
const express = require('express');

const config = require('./lib/config');
const presets = require('./lib/presets');
const watcher = require('./lib/watcher');
const jobs = require('./lib/jobs');
const ffmpeg = require('./lib/ffmpeg');
const { basicAuthMiddleware } = require('./lib/auth');
const apiRouter = require('./routes/api');
const ws = require('./ws');

const app = express();
app.use(basicAuthMiddleware);
app.use(express.json());
app.use('/api', apiRouter);
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
ws.attach(server);

watcher.on('file-ready', (filePath) => {
  const cfg = config.get();
  if (cfg.autoTranscodeOnArrival && cfg.defaultPresetId && presets.getById(cfg.defaultPresetId)) {
    jobs.enqueue(filePath, cfg.defaultPresetId);
  }
});

async function start() {
  const binaries = await ffmpeg.checkBinaries();
  if (!binaries.ffmpeg || !binaries.ffprobe) {
    console.warn('[djima] ATTENTION: ffmpeg/ffprobe introuvable dans le PATH. Installez FFmpeg pour activer le transcodage.');
  }
  watcher.start();

  const cfg = config.get();
  const port = process.env.PORT || cfg.port || 4590;
  server.listen(port, () => {
    console.log(`[djima] interface disponible sur http://localhost:${port}`);
  });
}

start();
