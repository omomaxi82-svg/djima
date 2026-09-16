from __future__ import annotations

import json
import queue
import time
from pathlib import Path

from flask import Blueprint, Response, current_app, jsonify, render_template, request, send_from_directory
from werkzeug.utils import secure_filename

from . import ffmpeg_utils
from .profiles import list_profiles

bp = Blueprint("main", __name__)


def _config():
    return current_app.broadcast_config


def _jobs():
    return current_app.job_manager


def _safe_path(base: Path, filename: str) -> Path:
    """Résout `filename` sous `base` en bloquant toute tentative de traversée de chemin."""
    name = Path(filename).name  # interdit les séparateurs de répertoire
    candidate = (base / name).resolve()
    if base.resolve() not in candidate.parents and candidate != base.resolve():
        raise ValueError("Chemin invalide")
    return candidate


@bp.get("/")
def index():
    return render_template("index.html")


@bp.get("/api/config")
def api_config():
    cfg = _config()
    return jsonify({
        "input_dir": str(cfg.input_dir),
        "output_dir": str(cfg.output_dir),
        "archive_dir": str(cfg.archive_dir) if cfg.archive_dir else None,
        "max_parallel_jobs": cfg.max_parallel_jobs,
        "profiles": list_profiles(),
    })


@bp.get("/api/files")
def api_files():
    cfg = _config()
    files = []
    for p in sorted(cfg.input_dir.iterdir()):
        if p.is_file() and not p.name.startswith("."):
            stat = p.stat()
            files.append({
                "filename": p.name,
                "size_bytes": stat.st_size,
                "mtime": stat.st_mtime,
            })
    return jsonify(files)


@bp.get("/api/outputs")
def api_outputs():
    cfg = _config()
    files = []
    for p in sorted(cfg.output_dir.iterdir()):
        if p.is_file() and not p.name.startswith("."):
            stat = p.stat()
            files.append({
                "filename": p.name,
                "size_bytes": stat.st_size,
                "mtime": stat.st_mtime,
            })
    return jsonify(files)


@bp.post("/api/upload")
def api_upload():
    cfg = _config()
    if "file" not in request.files:
        return jsonify({"error": "Aucun fichier reçu"}), 400
    uploaded = request.files["file"]
    if not uploaded.filename:
        return jsonify({"error": "Nom de fichier vide"}), 400
    filename = secure_filename(uploaded.filename)
    if not filename:
        return jsonify({"error": "Nom de fichier invalide"}), 400
    dest = cfg.input_dir / filename
    uploaded.save(dest)
    return jsonify({"filename": filename, "size_bytes": dest.stat().st_size})


@bp.post("/api/analyze")
def api_analyze():
    cfg = _config()
    data = request.get_json(force=True, silent=True) or {}
    filename = data.get("filename", "")
    scan_black = bool(data.get("scan_black", False))
    try:
        path = _safe_path(cfg.input_dir, filename)
    except ValueError:
        return jsonify({"error": "Chemin invalide"}), 400
    if not path.is_file():
        return jsonify({"error": "Fichier introuvable"}), 404

    result = ffmpeg_utils.analyze_file(cfg.ffprobe_bin, path)
    if scan_black and result.get("readable") and result.get("duration"):
        result["black_segments"] = ffmpeg_utils.blackdetect_scan(cfg.ffmpeg_bin, path)
        if result["black_segments"]:
            result.setdefault("issues", []).append(
                f"{len(result['black_segments'])} plage(s) de noir prolongé détectée(s)."
            )
            if result["verdict"] == "ok":
                result["verdict"] = "a_risque"
    return jsonify(result)


@bp.get("/api/profiles")
def api_profiles():
    return jsonify(list_profiles())


@bp.post("/api/jobs")
def api_create_job():
    cfg = _config()
    data = request.get_json(force=True, silent=True) or {}
    filename = data.get("filename", "")
    profile_id = data.get("profile_id", "")
    options = data.get("options", {}) or {}

    try:
        path = _safe_path(cfg.input_dir, filename)
    except ValueError:
        return jsonify({"error": "Chemin invalide"}), 400
    if not path.is_file():
        return jsonify({"error": "Fichier introuvable dans le dossier d'entrée"}), 404

    try:
        job = _jobs().submit(filename=path.name, profile_id=profile_id, options=options)
    except KeyError as exc:
        return jsonify({"error": str(exc)}), 400

    return jsonify(job.to_dict()), 201


@bp.get("/api/jobs")
def api_list_jobs():
    return jsonify(_jobs().list_jobs())


@bp.get("/api/jobs/<job_id>")
def api_get_job(job_id: str):
    job = _jobs().get(job_id)
    if not job:
        return jsonify({"error": "Job introuvable"}), 404
    return jsonify(job.to_dict())


@bp.post("/api/jobs/<job_id>/cancel")
def api_cancel_job(job_id: str):
    ok = _jobs().cancel(job_id)
    if not ok:
        return jsonify({"error": "Impossible d'annuler ce job"}), 400
    return jsonify({"ok": True})


@bp.get("/api/events")
def api_events():
    q = _jobs().subscribe()

    def stream():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    payload = q.get(timeout=15)
                    yield f"data: {json.dumps(payload)}\n\n"
                except queue.Empty:
                    yield ": keepalive\n\n"
        finally:
            _jobs().unsubscribe(q)

    return Response(stream(), mimetype="text/event-stream")


@bp.get("/api/download/<path:filename>")
def api_download(filename: str):
    cfg = _config()
    try:
        path = _safe_path(cfg.output_dir, filename)
    except ValueError:
        return jsonify({"error": "Chemin invalide"}), 400
    if not path.is_file():
        return jsonify({"error": "Fichier introuvable"}), 404
    return send_from_directory(cfg.output_dir, path.name, as_attachment=True)


@bp.delete("/api/outputs/<path:filename>")
def api_delete_output(filename: str):
    cfg = _config()
    try:
        path = _safe_path(cfg.output_dir, filename)
    except ValueError:
        return jsonify({"error": "Chemin invalide"}), 400
    if path.is_file():
        path.unlink()
    return jsonify({"ok": True})


@bp.delete("/api/files/<path:filename>")
def api_delete_input(filename: str):
    cfg = _config()
    try:
        path = _safe_path(cfg.input_dir, filename)
    except ValueError:
        return jsonify({"error": "Chemin invalide"}), 400
    if path.is_file():
        path.unlink()
    return jsonify({"ok": True})
