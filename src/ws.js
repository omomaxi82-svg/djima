const { Server } = require('socket.io');
const watcher = require('./lib/watcher');
const jobs = require('./lib/jobs');

function attach(httpServer) {
  const io = new Server(httpServer, {
    cors: { origin: false }
  });

  io.on('connection', (socket) => {
    socket.emit('files', watcher.list());
    socket.emit('jobs', jobs.list());
  });

  watcher.on('changed', (list) => io.emit('files', list));
  jobs.on('update', (job) => io.emit('job-update', job));
  jobs.on('progress', (job) => io.emit('job-progress', job));

  return io;
}

module.exports = { attach };
