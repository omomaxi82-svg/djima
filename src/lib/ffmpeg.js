const { spawn } = require('child_process');
const path = require('path');

const KNOWN_GOOD_VIDEO_CODECS = ['mpeg2video', 'dnxhd', 'prores', 'h264', 'hevc'];
const KNOWN_GOOD_AUDIO_CODECS = ['pcm_s16le', 'pcm_s24le', 'aac', 'mp2', 'ac3'];

const ERROR_PATTERNS = [
  /invalid data found/i,
  /moov atom not found/i,
  /error while decoding/i,
  /corrupt/i,
  /truncated/i,
  /header missing/i,
  /could not find codec parameters/i,
  /unsupported codec/i,
  /decode_slice_header error/i
];

let binaryStatus = null;

function runCapture(cmd, args, { timeoutMs } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { windowsHide: true });
    let stdout = '';
    let stderr = '';
    let killedForTimeout = false;
    const timer = timeoutMs
      ? setTimeout(() => {
          killedForTimeout = true;
          child.kill('SIGKILL');
        }, timeoutMs)
      : null;

    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: `${stderr}\n${err.message}`, timedOut: false });
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut: killedForTimeout });
    });
  });
}

async function checkBinaries() {
  if (binaryStatus) return binaryStatus;
  const ffmpegRes = await runCapture('ffmpeg', ['-version']);
  const ffprobeRes = await runCapture('ffprobe', ['-version']);
  binaryStatus = {
    ffmpeg: ffmpegRes.code === 0,
    ffprobe: ffprobeRes.code === 0,
    ffmpegVersion: ffmpegRes.code === 0 ? ffmpegRes.stdout.split('\n')[0] : null,
    ffprobeVersion: ffprobeRes.code === 0 ? ffprobeRes.stdout.split('\n')[0] : null
  };
  return binaryStatus;
}

async function probe(filePath) {
  const res = await runCapture('ffprobe', [
    '-hide_banner', '-v', 'error',
    '-show_format', '-show_streams',
    '-of', 'json',
    filePath
  ], { timeoutMs: 30000 });

  if (res.code !== 0 || !res.stdout.trim()) {
    return { ok: false, error: res.stderr.trim() || 'ffprobe a echoue', timedOut: res.timedOut };
  }

  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch (err) {
    return { ok: false, error: `Reponse ffprobe illisible: ${err.message}` };
  }

  const streams = data.streams || [];
  const videoStream = streams.find((s) => s.codec_type === 'video');
  const audioStream = streams.find((s) => s.codec_type === 'audio');
  const duration = parseFloat((data.format && data.format.duration) || (videoStream && videoStream.duration) || '0') || 0;

  return {
    ok: true,
    duration,
    formatName: data.format ? data.format.format_name : null,
    sizeBytes: data.format ? parseInt(data.format.size, 10) || null : null,
    video: videoStream
      ? {
          codec: videoStream.codec_name,
          width: videoStream.width,
          height: videoStream.height,
          pixFmt: videoStream.pix_fmt,
          frameRate: videoStream.r_frame_rate
        }
      : null,
    audio: audioStream
      ? {
          codec: audioStream.codec_name,
          sampleRate: audioStream.sample_rate,
          channels: audioStream.channels
        }
      : null
  };
}

async function healthCheck(filePath, blackdetectConfig = {}) {
  const {
    enabled = true,
    minDurationSec = 2,
    pixelThreshold = 0.1,
    maxAllowedBlackRatio = 0.05
  } = blackdetectConfig;

  const issues = [];
  const info = await probe(filePath);

  if (!info.ok) {
    issues.push({ code: 'illisible', message: `Fichier illisible ou corrompu: ${info.error}` });
    return { status: 'corrompu', issues, probe: info };
  }

  if (!info.video && !info.audio) {
    issues.push({ code: 'aucun_flux', message: 'Aucun flux audio ou video detecte' });
  }

  if (info.video && !KNOWN_GOOD_VIDEO_CODECS.includes(info.video.codec)) {
    issues.push({
      code: 'codec_video_non_standard',
      message: `Codec video "${info.video.codec}" non standard pour la diffusion (transcodage recommande)`
    });
  }
  if (info.audio && !KNOWN_GOOD_AUDIO_CODECS.includes(info.audio.codec)) {
    issues.push({
      code: 'codec_audio_non_standard',
      message: `Codec audio "${info.audio.codec}" non standard pour la diffusion (transcodage recommande)`
    });
  }

  let blackRatio = 0;
  if (enabled && info.video && info.duration > 0) {
    const filter = `blackdetect=d=${minDurationSec}:pix_th=${pixelThreshold}`;
    const res = await runCapture('ffmpeg', [
      '-hide_banner', '-nostats', '-loglevel', 'info',
      '-i', filePath,
      '-vf', filter,
      '-an', '-f', 'null', '-'
    ], { timeoutMs: 120000 });

    const lines = res.stderr.split('\n');
    let blackTotal = 0;
    let decodeErrorFound = false;
    for (const line of lines) {
      const m = line.match(/black_duration:([\d.]+)/);
      if (m) blackTotal += parseFloat(m[1]);
      if (!line.includes('blackdetect') && ERROR_PATTERNS.some((re) => re.test(line))) {
        decodeErrorFound = true;
      }
    }
    blackRatio = info.duration > 0 ? blackTotal / info.duration : 0;
    if (blackRatio > maxAllowedBlackRatio) {
      issues.push({
        code: 'image_noire',
        message: `Image noire prolongee detectee (${Math.round(blackRatio * 100)}% de la duree)`
      });
    }
    if (res.timedOut) {
      issues.push({ code: 'analyse_incomplete', message: 'Analyse image noire interrompue (delai depasse)' });
    }
    if (decodeErrorFound) {
      issues.push({ code: 'erreur_decodage', message: 'Erreurs de decodage detectees pendant la lecture du fichier' });
    }
  }

  const status = issues.length === 0 ? 'ok' : (issues.some((i) => ['illisible', 'erreur_decodage'].includes(i.code)) ? 'corrompu' : 'anomalie');

  return { status, issues, probe: info, blackRatio };
}

function buildOutputPath(inputFile, preset, outputDir) {
  const base = path.basename(inputFile, path.extname(inputFile));
  return path.join(outputDir, `${base}.${preset.extension}`);
}

function transcode(inputFile, outputFile, preset, { durationSec = 0, onProgress, onLog } = {}) {
  const args = [
    '-y', '-hide_banner', '-nostats', '-loglevel', 'error',
    '-err_detect', 'ignore_err',
    '-fflags', '+genpts+igndts',
    '-progress', 'pipe:1',
    '-i', inputFile,
    ...preset.args,
    outputFile
  ];

  return new Promise((resolve) => {
    const child = spawn('ffmpeg', args, { windowsHide: true });
    let stderrTail = [];
    let progressBuf = '';

    child.stdout.on('data', (chunk) => {
      progressBuf += chunk.toString();
      const lines = progressBuf.split('\n');
      progressBuf = lines.pop();
      let out = {};
      for (const line of lines) {
        const [key, value] = line.split('=');
        if (!key) continue;
        out[key.trim()] = (value || '').trim();
        if (key.trim() === 'progress') {
          const outTimeMs = parseInt(out.out_time_ms, 10) || 0;
          const percent = durationSec > 0 ? Math.min(100, (outTimeMs / 1e6 / durationSec) * 100) : null;
          if (onProgress) {
            onProgress({
              percent: percent !== null ? Math.round(percent * 10) / 10 : null,
              speed: out.speed || null,
              fps: out.fps || null,
              done: value.trim() === 'end'
            });
          }
          out = {};
        }
      }
    });

    child.stderr.on('data', (d) => {
      const text = d.toString();
      stderrTail.push(text);
      if (stderrTail.length > 200) stderrTail.shift();
      if (onLog) onLog(text);
    });

    child.on('error', (err) => {
      resolve({ success: false, code: -1, stderr: err.message });
    });

    child.on('close', (code) => {
      resolve({ success: code === 0, code, stderr: stderrTail.join('') });
    });
  });
}

module.exports = {
  checkBinaries,
  probe,
  healthCheck,
  buildOutputPath,
  transcode,
  KNOWN_GOOD_VIDEO_CODECS,
  KNOWN_GOOD_AUDIO_CODECS
};
