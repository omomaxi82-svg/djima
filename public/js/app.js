(() => {
  const state = {
    files: [],
    jobs: [],
    presets: [],
    config: null,
    fileHealth: {}, // path -> health result
    selected: new Set()
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  function fmtBytes(n) {
    if (!n && n !== 0) return '-';
    const units = ['o', 'Ko', 'Mo', 'Go', 'To'];
    let i = 0; let v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
  }

  function fmtDate(iso) {
    if (!iso) return '-';
    const d = new Date(iso);
    return d.toLocaleString('fr-FR');
  }

  const STATUS_LABELS = {
    en_attente: { label: 'En attente', cls: 'info' },
    analyse: { label: 'Analyse en cours', cls: 'info' },
    transcodage: { label: 'Transcodage', cls: 'info' },
    verification: { label: 'Verification', cls: 'info' },
    termine: { label: 'Termine', cls: 'ok' },
    a_verifier: { label: 'A verifier', cls: 'warn' },
    echec: { label: 'Echec', cls: 'danger' },
    ok: { label: 'OK', cls: 'ok' },
    anomalie: { label: 'Anomalie', cls: 'warn' },
    corrompu: { label: 'Corrompu', cls: 'danger' },
    non_analyse: { label: 'Non analyse', cls: '' }
  };

  function badge(status) {
    const meta = STATUS_LABELS[status] || { label: status, cls: '' };
    return `<span class="badge ${meta.cls}">${meta.label}</span>`;
  }

  // ---------- API ----------
  async function api(path, opts) {
    const res = await fetch(`/api${path}`, {
      headers: { 'Content-Type': 'application/json' },
      ...opts
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || `Erreur ${res.status}`);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------- Rendering ----------
  function presetOptions(selectedId) {
    return state.presets
      .map((p) => `<option value="${p.id}" ${p.id === selectedId ? 'selected' : ''}>${p.recommendedForCynergie ? '★ ' : ''}${p.label}</option>`)
      .join('');
  }

  function populatePresetSelects() {
    const defaultId = state.config ? state.config.defaultPresetId : null;
    $('#bulkPreset').innerHTML = presetOptions(defaultId);
    $('#defaultPresetSelect').innerHTML = `<option value="">(aucun)</option>${presetOptions(defaultId)}`;
    if (state.config) $('#defaultPresetSelect').value = state.config.defaultPresetId || '';
  }

  function renderFiles() {
    const tbody = $('#filesTbody');
    $('#filesEmptyHint').classList.toggle('hidden', state.files.length > 0);
    tbody.innerHTML = state.files.map((f) => {
      const health = state.fileHealth[f.path];
      const statusHtml = health
        ? badge(health.status) + (health.issues && health.issues.length
            ? `<ul class="issues-list">${health.issues.map((i) => `<li>${i.message}</li>`).join('')}</ul>`
            : '')
        : badge('non_analyse');
      const defaultPreset = state.config ? state.config.defaultPresetId : null;
      return `
        <tr data-path="${encodeURIComponent(f.path)}">
          <td><input type="checkbox" class="row-check"></td>
          <td>${f.name}</td>
          <td>${fmtBytes(f.size)}</td>
          <td>${statusHtml}</td>
          <td><select class="row-preset">${presetOptions(defaultPreset)}</select></td>
          <td class="row-actions">
            <button class="btn btn-ghost btn-small act-analyze">Analyser</button>
            <button class="btn btn-primary btn-small act-transcode">Transcoder</button>
          </td>
        </tr>`;
    }).join('');
  }

  function jobProgressLabel(job) {
    if (job.status === 'transcodage' && job.progress && job.progress.percent != null) {
      return `${job.progress.percent}% ${job.progress.speed ? `· ${job.progress.speed}` : ''}`;
    }
    return STATUS_LABELS[job.status] ? STATUS_LABELS[job.status].label : job.status;
  }

  function renderQueue() {
    const active = state.jobs.filter((j) => !['termine', 'echec', 'a_verifier'].includes(j.status));
    $('#queueEmptyHint').classList.toggle('hidden', active.length > 0);
    $('#queueList').innerHTML = active.map((j) => {
      const pct = (j.progress && j.progress.percent) || 0;
      return `
        <div class="queue-item">
          <div class="queue-item-head">
            <span class="queue-item-name" title="${j.inputBaseName}">${j.inputBaseName}</span>
            ${badge(j.status)}
          </div>
          <div class="queue-item-meta">
            <span>${j.presetLabel}</span>
            <span>${jobProgressLabel(j)}</span>
          </div>
          <div class="progress-bar"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        </div>`;
    }).join('');
  }

  function renderHistory() {
    const done = state.jobs.filter((j) => ['termine', 'echec', 'a_verifier'].includes(j.status));
    $('#historyTbody').innerHTML = done.map((j) => `
      <tr>
        <td>${j.inputBaseName}</td>
        <td>${j.presetLabel}</td>
        <td>${badge(j.status)}${j.error ? `<div class="issues-list">${j.error}</div>` : ''}</td>
        <td>${fmtDate(j.startedAt)}</td>
        <td>${fmtDate(j.finishedAt)}</td>
        <td>${j.outputFile ? j.outputFile.split('/').pop() : '-'}</td>
      </tr>`).join('');
  }

  function renderPresetsSettings() {
    $('#presetsList').innerHTML = state.presets.map((p) => `
      <div class="preset-item">
        <div>
          <span class="preset-tag">${p.category}${p.recommendedForCynergie ? ' · recommande Cynergie' : ''}</span>
          <h3>${p.label}</h3>
          <p>${p.description || ''}</p>
        </div>
        ${p.custom ? `<button class="btn btn-danger btn-small act-delete-preset" data-id="${p.id}">Supprimer</button>` : ''}
      </div>`).join('');
  }

  function renderStatusPills(status) {
    const ffOk = status.binaries.ffmpeg && status.binaries.ffprobe;
    $('#statusPills').innerHTML = `
      <span class="pill ${ffOk ? 'ok' : 'danger'}"><span class="dot"></span>FFmpeg ${ffOk ? 'OK' : 'absent'}</span>
      <span class="pill"><span class="dot"></span>${status.fileCount} fichier(s) en entree</span>
      <span class="pill"><span class="dot"></span>${status.activeJobs} job(s) actif(s)</span>
    `;
    $('#binaryWarning').classList.toggle('hidden', ffOk);
  }

  function fillConfigForm() {
    const c = state.config;
    if (!c) return;
    const form = $('#configForm');
    form.inputDir.value = c.inputDir;
    form.outputDir.value = c.outputDir;
    form.quarantineDir.value = c.quarantineDir;
    form.concurrency.value = c.concurrency;
    form.autoTranscodeOnArrival.checked = !!c.autoTranscodeOnArrival;
    form.blackdetectEnabled.checked = !!(c.blackdetect && c.blackdetect.enabled);
    form.blackdetectMinDuration.value = c.blackdetect ? c.blackdetect.minDurationSec : 2;
    form.blackdetectMaxRatio.value = c.blackdetect ? c.blackdetect.maxAllowedBlackRatio : 0.05;
    form.authEnabled.checked = !!(c.auth && c.auth.enabled);
    form.authUsername.value = c.auth ? c.auth.username : '';
    form.authPassword.value = c.auth ? c.auth.password : '';
  }

  // ---------- Actions ----------
  async function analyzeFile(filePath) {
    const health = await api('/files/analyze', { method: 'POST', body: JSON.stringify({ path: filePath }) });
    state.fileHealth[filePath] = health;
    renderFiles();
  }

  async function transcodeFiles(paths, presetId) {
    await api('/jobs', { method: 'POST', body: JSON.stringify({ files: paths, presetId }) });
  }

  function getSelectedPaths() {
    return $$('#filesTbody tr').filter((tr) => tr.querySelector('.row-check').checked)
      .map((tr) => decodeURIComponent(tr.dataset.path));
  }

  function bindFilesTable() {
    $('#checkAll').addEventListener('change', (e) => {
      $$('.row-check').forEach((cb) => { cb.checked = e.target.checked; });
    });

    $('#filesTbody').addEventListener('click', async (e) => {
      const tr = e.target.closest('tr');
      if (!tr) return;
      const filePath = decodeURIComponent(tr.dataset.path);
      const presetId = tr.querySelector('.row-preset').value;
      try {
        if (e.target.classList.contains('act-analyze')) {
          e.target.disabled = true;
          await analyzeFile(filePath);
          e.target.disabled = false;
        } else if (e.target.classList.contains('act-transcode')) {
          e.target.disabled = true;
          await transcodeFiles([filePath], presetId);
          e.target.disabled = false;
        }
      } catch (err) {
        alert(err.message);
        e.target.disabled = false;
      }
    });

    $('#btnBulkAnalyze').addEventListener('click', async () => {
      const paths = getSelectedPaths();
      if (!paths.length) return alert('Selectionnez au moins un fichier.');
      for (const p of paths) {
        try { await analyzeFile(p); } catch (err) { console.error(err); }
      }
    });

    $('#btnBulkTranscode').addEventListener('click', async () => {
      const paths = getSelectedPaths();
      if (!paths.length) return alert('Selectionnez au moins un fichier.');
      const presetId = $('#bulkPreset').value;
      try {
        await transcodeFiles(paths, presetId);
      } catch (err) {
        alert(err.message);
      }
    });
  }

  function bindTabs() {
    $$('.tab-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        $$('.tab-btn').forEach((b) => b.classList.remove('active'));
        $$('.tab-panel').forEach((p) => p.classList.remove('active'));
        btn.classList.add('active');
        $(`#tab-${btn.dataset.tab}`).classList.add('active');
      });
    });
  }

  function bindConfigForm() {
    $('#configForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const patch = {
        inputDir: form.inputDir.value,
        outputDir: form.outputDir.value,
        quarantineDir: form.quarantineDir.value,
        concurrency: parseInt(form.concurrency.value, 10),
        autoTranscodeOnArrival: form.autoTranscodeOnArrival.checked,
        defaultPresetId: $('#defaultPresetSelect').value,
        blackdetect: {
          enabled: form.blackdetectEnabled.checked,
          minDurationSec: parseFloat(form.blackdetectMinDuration.value),
          pixelThreshold: (state.config.blackdetect && state.config.blackdetect.pixelThreshold) || 0.1,
          maxAllowedBlackRatio: parseFloat(form.blackdetectMaxRatio.value)
        },
        auth: {
          enabled: form.authEnabled.checked,
          username: form.authUsername.value,
          password: form.authPassword.value
        }
      };
      state.config = await api('/config', { method: 'PUT', body: JSON.stringify(patch) });
      $('#configSaved').classList.remove('hidden');
      setTimeout(() => $('#configSaved').classList.add('hidden'), 2500);
      populatePresetSelects();
    });
  }

  function bindPresetForm() {
    $('#presetForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const form = e.target;
      const args = form.args.value.split(/\s+/).map((s) => s.trim()).filter(Boolean);
      try {
        const created = await api('/presets', {
          method: 'POST',
          body: JSON.stringify({
            id: form.id.value.trim(),
            label: form.label.value.trim(),
            category: form.category.value.trim() || 'Autres',
            extension: form.extension.value.trim() || 'mp4',
            description: form.description.value.trim(),
            recommendedForCynergie: form.recommendedForCynergie.checked,
            args
          })
        });
        state.presets.push(created);
        renderPresetsSettings();
        populatePresetSelects();
        renderFiles();
        form.reset();
      } catch (err) {
        alert(err.message);
      }
    });

    $('#presetsList').addEventListener('click', async (e) => {
      if (!e.target.classList.contains('act-delete-preset')) return;
      const id = e.target.dataset.id;
      if (!confirm('Supprimer ce preset ?')) return;
      await api(`/presets/${id}`, { method: 'DELETE' });
      state.presets = state.presets.filter((p) => p.id !== id);
      renderPresetsSettings();
      populatePresetSelects();
      renderFiles();
    });
  }

  function upsertJob(job) {
    const idx = state.jobs.findIndex((j) => j.id === job.id);
    if (idx === -1) state.jobs.unshift(job); else state.jobs[idx] = job;
  }

  // ---------- Init ----------
  async function init() {
    bindTabs();
    bindFilesTable();
    bindConfigForm();
    bindPresetForm();

    const [status, config, presets, files, jobs] = await Promise.all([
      api('/status'), api('/config'), api('/presets'), api('/files'), api('/jobs')
    ]);
    state.config = config;
    state.presets = presets;
    state.files = files;
    state.jobs = jobs;

    renderStatusPills(status);
    populatePresetSelects();
    fillConfigForm();
    renderFiles();
    renderQueue();
    renderHistory();
    renderPresetsSettings();

    const socket = io();
    socket.on('files', (list) => { state.files = list; renderFiles(); });
    socket.on('jobs', (list) => { state.jobs = list; renderQueue(); renderHistory(); });
    socket.on('job-update', (job) => { upsertJob(job); renderQueue(); renderHistory(); });
    socket.on('job-progress', (job) => { upsertJob(job); renderQueue(); });

    setInterval(async () => {
      try { renderStatusPills(await api('/status')); } catch { /* serveur momentanement indisponible */ }
    }, 15000);
  }

  init();
})();
