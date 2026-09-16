(() => {
  "use strict";

  const state = {
    profilesById: new Map(),
    selectedProfile: null,
    selectedFiles: new Set(),
    jobCards: new Map(),
  };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const fmtBytes = (n) => {
    if (!n && n !== 0) return "?";
    const units = ["o", "Ko", "Mo", "Go", "To"];
    let i = 0, v = n;
    while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
    return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
  };

  const fmtDuration = (s) => {
    if (!s && s !== 0) return "?";
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = Math.floor(s % 60);
    return [h, m, sec].map((x) => String(x).padStart(2, "0")).join(":");
  };

  const STATUS_LABELS = {
    en_attente: "En attente",
    analyse: "Analyse",
    mesure_loudness: "Mesure loudness",
    encodage: "Encodage",
    verification: "Vérification",
    termine: "Terminé",
    erreur: "Erreur",
    annule: "Annulé",
  };

  const STATUS_BADGE = {
    en_attente: "badge-neutral",
    analyse: "badge-info",
    mesure_loudness: "badge-info",
    encodage: "badge-info",
    verification: "badge-info",
    termine: "badge-ok",
    erreur: "badge-error",
    annule: "badge-warn",
  };

  async function api(path, opts) {
    const res = await fetch(path, opts);
    if (!res.ok) {
      let msg = res.statusText;
      try { const j = await res.json(); msg = j.error || msg; } catch (_) {}
      throw new Error(msg);
    }
    if (res.status === 204) return null;
    return res.json();
  }

  // ---------------------------------------------------------------- config
  async function loadConfig() {
    const cfg = await api("/api/config");
    $("#meta-input-dir").textContent = cfg.input_dir;
    $("#meta-output-dir").textContent = cfg.output_dir;
    $("#meta-parallel").textContent = cfg.max_parallel_jobs;
    renderProfiles(cfg.profiles);
  }

  function renderProfiles(groups) {
    const container = $("#profile-groups");
    container.innerHTML = "";
    let first = true;
    for (const group of groups) {
      const title = document.createElement("div");
      title.className = "profile-group-title";
      title.textContent = group.category_label;
      container.appendChild(title);

      for (const profile of group.profiles) {
        state.profilesById.set(profile.id, profile);
        const tile = document.createElement("label");
        tile.className = "profile-tile";
        tile.dataset.profileId = profile.id;
        tile.innerHTML = `
          <input type="radio" name="profile" value="${profile.id}" ${first ? "checked" : ""}>
          <div>
            <strong>${profile.label} ${profile.certified ? "" : '<span class="tag-experimental">à valider</span>'}</strong>
            <p>${profile.description}</p>
          </div>`;
        const radio = $("input", tile);
        radio.addEventListener("change", () => selectProfile(profile.id));
        if (first) { tile.classList.add("selected"); state.selectedProfile = profile.id; first = false; }
        container.appendChild(tile);
      }
    }
  }

  function selectProfile(id) {
    state.selectedProfile = id;
    $$(".profile-tile").forEach((t) => t.classList.toggle("selected", t.dataset.profileId === id));
  }

  // ------------------------------------------------------------- input files
  async function loadFiles() {
    const files = await api("/api/files");
    const list = $("#file-list");
    list.innerHTML = "";
    if (!files.length) {
      list.innerHTML = '<p class="empty-hint">Aucun fichier dans le dossier d\'entrée.</p>';
      return;
    }
    const tpl = $("#tpl-file-row");
    for (const f of files) {
      const node = tpl.content.cloneNode(true);
      const row = $(".file-row", node);
      row.dataset.filename = f.filename;
      $(".file-name", node).textContent = f.filename;
      $(".file-meta", node).textContent = `${fmtBytes(f.size_bytes)} · ${new Date(f.mtime * 1000).toLocaleString("fr-FR")}`;

      const checkbox = $(".file-select", node);
      checkbox.checked = state.selectedFiles.has(f.filename);
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) state.selectedFiles.add(f.filename);
        else state.selectedFiles.delete(f.filename);
        updateLaunchButton();
      });

      $(".btn-analyze", node).addEventListener("click", () => runAnalysis(f.filename, row, false));
      $(".btn-analyze-black", node).addEventListener("click", () => runAnalysis(f.filename, row, true));
      $(".btn-delete", node).addEventListener("click", async () => {
        if (!confirm(`Supprimer ${f.filename} du dossier d'entrée ?`)) return;
        await api(`/api/files/${encodeURIComponent(f.filename)}`, { method: "DELETE" });
        state.selectedFiles.delete(f.filename);
        loadFiles();
      });

      list.appendChild(node);
    }
    updateLaunchButton();
  }

  async function runAnalysis(filename, row, scanBlack) {
    const badge = $(".verdict", row);
    const box = $(".file-analysis", row);
    badge.textContent = scanBlack ? "analyse approfondie…" : "analyse…";
    badge.className = "badge badge-info verdict";
    try {
      const r = await api("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, scan_black: scanBlack }),
      });
      renderAnalysis(r, badge, box);
    } catch (e) {
      badge.textContent = "erreur";
      badge.className = "badge badge-error verdict";
      box.innerHTML = `<span class="issue corrupt">${e.message}</span>`;
    }
  }

  function renderAnalysis(r, badge, box) {
    const verdictMap = {
      ok: ["conforme", "badge-ok"],
      a_risque: ["à risque", "badge-warn"],
      corrompu: ["corrompu", "badge-error"],
    };
    const [label, cls] = verdictMap[r.verdict] || ["inconnu", "badge-neutral"];
    badge.textContent = label;
    badge.className = `badge ${cls} verdict`;

    let html = "";
    if (r.video) {
      html += `<dl>
        <dt>Vidéo</dt><dd>${r.video.codec || "?"} · ${r.video.width}x${r.video.height} · ${r.video.fps} i/s ${r.video.interlaced ? "(entrelacé)" : ""}</dd>
        <dt>Conteneur</dt><dd>${r.container || "?"}</dd>
        <dt>Durée</dt><dd>${fmtDuration(r.duration)}</dd>`;
      if (r.audio && r.audio.length) {
        html += `<dt>Audio</dt><dd>${r.audio.map((a) => `${a.codec} ${a.channels}ch/${a.sample_rate}Hz`).join(", ")}</dd>`;
      }
      html += `</dl>`;
    }
    if (r.issues && r.issues.length) {
      html += r.issues.map((i) => `<div class="issue ${r.verdict === "corrompu" ? "corrupt" : ""}">⚠ ${i}</div>`).join("");
    }
    if (r.black_segments && r.black_segments.length) {
      html += `<div class="issue">Plans noirs : ${r.black_segments.map((s) => `${fmtDuration(s.start)}→${fmtDuration(s.end)}`).join(", ")}</div>`;
    }
    box.innerHTML = html;
  }

  function updateLaunchButton() {
    $("#selection-count").textContent = state.selectedFiles.size;
    $("#launch-btn").disabled = state.selectedFiles.size === 0;
  }

  // ------------------------------------------------------------------ upload
  async function uploadFiles(fileList) {
    for (const file of fileList) {
      const form = new FormData();
      form.append("file", file);
      try {
        await api("/api/upload", { method: "POST", body: form });
      } catch (e) {
        alert(`Échec de l'envoi de ${file.name} : ${e.message}`);
      }
    }
    loadFiles();
  }

  function setupDropzone() {
    const zone = $("#dropzone");
    const input = $("#file-input");
    input.addEventListener("change", () => uploadFiles(input.files));
    ["dragenter", "dragover"].forEach((evt) =>
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.add("dragover"); })
    );
    ["dragleave", "drop"].forEach((evt) =>
      zone.addEventListener(evt, (e) => { e.preventDefault(); zone.classList.remove("dragover"); })
    );
    zone.addEventListener("drop", (e) => {
      if (e.dataTransfer.files.length) uploadFiles(e.dataTransfer.files);
    });
  }

  // -------------------------------------------------------------------- jobs
  function collectOptions() {
    return {
      normalize_loudness: $("#opt-normalize").checked,
      deinterlace: $("#opt-deinterlace").checked,
      trim_black: $("#opt-trim-black").checked,
      reset_timecode: $("#opt-reset-tc").checked,
    };
  }

  async function launchSelection() {
    const files = Array.from(state.selectedFiles);
    const options = collectOptions();
    const profileId = state.selectedProfile;
    $("#launch-btn").disabled = true;
    for (const filename of files) {
      try {
        await api("/api/jobs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename, profile_id: profileId, options }),
        });
      } catch (e) {
        alert(`Impossible de lancer le job pour ${filename} : ${e.message}`);
      }
    }
    state.selectedFiles.clear();
    loadFiles();
    updateLaunchButton();
  }

  function jobCardFor(job) {
    let card = state.jobCards.get(job.id);
    if (card) return card;
    const tpl = $("#tpl-job-card");
    const node = tpl.content.cloneNode(true);
    card = $(".job-card", node);
    state.jobCards.set(job.id, card);
    $("#job-list").prepend(card);
    $(".empty-hint", $("#job-list"))?.remove();
    return card;
  }

  function renderJob(job) {
    const emptyHint = $("#job-list .empty-hint");
    if (emptyHint) emptyHint.remove();
    const card = jobCardFor(job);
    card.dataset.jobId = job.id;
    $(".job-filename", card).textContent = job.filename;
    const profile = state.profilesById.get(job.profile_id);
    $(".job-profile", card).textContent = profile ? profile.label : job.profile_id;

    const badge = $(".status", card);
    badge.textContent = STATUS_LABELS[job.status] || job.status;
    badge.className = `badge status ${STATUS_BADGE[job.status] || "badge-neutral"}`;

    $(".progress-fill", card).style.width = `${job.progress || 0}%`;
    $(".job-phase", card).textContent = job.phase || "";
    $(".job-speed", card).textContent = job.speed ? `${job.speed}` : "";

    const errBox = $(".job-error", card);
    errBox.textContent = job.error ? `Erreur : ${job.error}` : "";

    const resultBox = $(".job-result", card);
    resultBox.innerHTML = "";
    if (job.status === "termine" && job.output_filename) {
      resultBox.innerHTML = `Fichier généré : <strong>${job.output_filename}</strong> — `
        + `<a href="/api/download/${encodeURIComponent(job.output_filename)}">télécharger</a>`;
      if (job.post_check && job.post_check.issues && job.post_check.issues.length) {
        resultBox.innerHTML += job.post_check.issues.map((i) => `<div class="issue">⚠ ${i}</div>`).join("");
      }
    }

    const cancelBtn = $(".btn-cancel", card);
    const cancellable = ["en_attente", "analyse", "mesure_loudness", "encodage", "verification"].includes(job.status);
    cancelBtn.style.display = cancellable ? "inline-block" : "none";
    cancelBtn.onclick = async () => {
      try { await api(`/api/jobs/${job.id}/cancel`, { method: "POST" }); } catch (e) { alert(e.message); }
    };

    if (job.status === "termine" || job.status === "erreur" || job.status === "annule") {
      loadOutputs();
    }
  }

  async function loadJobs() {
    const jobs = await api("/api/jobs");
    if (!jobs.length) return;
    for (const job of jobs.slice().reverse()) renderJob(job);
  }

  function connectEvents() {
    const es = new EventSource("/api/events");
    es.onmessage = (evt) => {
      const job = JSON.parse(evt.data);
      renderJob(job);
    };
    es.onerror = () => {
      es.close();
      setTimeout(connectEvents, 3000);
    };
  }

  // --------------------------------------------------------------- outputs
  async function loadOutputs() {
    const files = await api("/api/outputs");
    const list = $("#output-list");
    list.innerHTML = "";
    if (!files.length) {
      list.innerHTML = '<p class="empty-hint">Aucun fichier généré pour le moment.</p>';
      return;
    }
    const tpl = $("#tpl-output-row");
    for (const f of files) {
      const node = tpl.content.cloneNode(true);
      $(".file-name", node).textContent = f.filename;
      $(".file-meta", node).textContent = `${fmtBytes(f.size_bytes)} · ${new Date(f.mtime * 1000).toLocaleString("fr-FR")}`;
      const dl = $(".btn-download", node);
      dl.href = `/api/download/${encodeURIComponent(f.filename)}`;
      $(".btn-delete", node).addEventListener("click", async () => {
        if (!confirm(`Supprimer ${f.filename} du dossier de sortie ?`)) return;
        await api(`/api/outputs/${encodeURIComponent(f.filename)}`, { method: "DELETE" });
        loadOutputs();
      });
      list.appendChild(node);
    }
  }

  // ---------------------------------------------------------------- init
  document.addEventListener("DOMContentLoaded", async () => {
    setupDropzone();
    $("#refresh-files").addEventListener("click", loadFiles);
    $("#refresh-outputs").addEventListener("click", loadOutputs);
    $("#launch-btn").addEventListener("click", launchSelection);

    await loadConfig();
    await Promise.all([loadFiles(), loadOutputs(), loadJobs()]);
    connectEvents();
  });
})();
