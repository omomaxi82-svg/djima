const chokidar = require('chokidar');
const fs = require('fs');
const path = require('path');
const EventEmitter = require('events');
const config = require('./config');

const VIDEO_EXTENSIONS = new Set([
  '.mxf', '.mov', '.mp4', '.mkv', '.mpg', '.mpeg', '.ts', '.m2ts', '.avi', '.wav', '.mp3', '.wmv'
]);

class Watcher extends EventEmitter {
  constructor() {
    super();
    this.files = new Map();
    this.watcherInstance = null;
  }

  start() {
    if (this.watcherInstance) this.watcherInstance.close();
    const { inputDir } = config.getResolvedDirs();
    fs.mkdirSync(inputDir, { recursive: true });
    this.files.clear();

    this.watcherInstance = chokidar.watch(inputDir, {
      depth: 0,
      ignoreInitial: false,
      awaitWriteFinish: { stabilityThreshold: 2000, pollInterval: 500 }
    });

    this.watcherInstance.on('add', (filePath) => this.onAdd(filePath));
    this.watcherInstance.on('unlink', (filePath) => this.onRemove(filePath));
    this.watcherInstance.on('error', (err) => this.emit('error', err));
  }

  onAdd(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (!VIDEO_EXTENSIONS.has(ext)) return;
    let stat;
    try {
      stat = fs.statSync(filePath);
    } catch {
      return;
    }
    this.files.set(filePath, {
      name: path.basename(filePath),
      path: filePath,
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      addedAt: new Date().toISOString()
    });
    this.emit('changed', this.list());
    this.emit('file-ready', filePath);
  }

  onRemove(filePath) {
    if (this.files.delete(filePath)) {
      this.emit('changed', this.list());
    }
  }

  list() {
    return [...this.files.values()].sort((a, b) => b.mtimeMs - a.mtimeMs);
  }
}

module.exports = new Watcher();
