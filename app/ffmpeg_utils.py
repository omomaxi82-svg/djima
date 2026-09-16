"""
Utilitaires bas niveau autour de ffmpeg/ffprobe :
  - analyse d'un fichier (ffprobe) et détection d'anomalies probables
  - détection des plans noirs prolongés (blackdetect)
  - mesure de loudness EBU R128 (2 passes)
  - construction et exécution des commandes de transcodage avec suivi de
    progression
"""

from __future__ import annotations

import json
import re
import subprocess
import time
from pathlib import Path
from typing import Callable, Optional

from .profiles import Profile

# Fréquences image "conformes" attendues en diffusion PAL
VALID_FRAME_RATES = {25.0, 50.0, 12.5}


def _run(cmd: list[str], timeout: Optional[int] = None) -> subprocess.CompletedProcess:
    return subprocess.run(
        cmd, capture_output=True, text=True, timeout=timeout, check=False
    )


def ffprobe_json(ffprobe_bin: str, path: Path) -> dict:
    cmd = [
        ffprobe_bin, "-v", "error", "-print_format", "json",
        "-show_format", "-show_streams", str(path),
    ]
    proc = _run(cmd, timeout=60)
    if proc.returncode != 0 or not proc.stdout.strip():
        raise RuntimeError(f"ffprobe a échoué : {proc.stderr.strip() or 'sortie vide'}")
    return json.loads(proc.stdout)


def _parse_frame_rate(rate_str: str) -> float:
    try:
        if "/" in rate_str:
            num, den = rate_str.split("/")
            den = float(den)
            return float(num) / den if den else 0.0
        return float(rate_str)
    except (ValueError, ZeroDivisionError):
        return 0.0


def analyze_file(ffprobe_bin: str, path: Path) -> dict:
    """Analyse un fichier et remonte un diagnostic exploitable par l'UI."""
    issues: list[str] = []

    try:
        probe = ffprobe_json(ffprobe_bin, path)
    except Exception as exc:  # ffprobe n'a pas pu lire le fichier -> corrompu/illisible
        return {
            "path": str(path),
            "filename": path.name,
            "readable": False,
            "verdict": "corrompu",
            "issues": [f"Fichier illisible par ffprobe : {exc}"],
            "video": None,
            "audio": [],
            "duration": None,
            "container": None,
            "size_bytes": path.stat().st_size if path.exists() else None,
        }

    fmt = probe.get("format", {})
    streams = probe.get("streams", [])
    video_streams = [s for s in streams if s.get("codec_type") == "video"]
    audio_streams = [s for s in streams if s.get("codec_type") == "audio"]

    duration = float(fmt.get("duration", 0) or 0)
    if duration <= 0:
        issues.append("Durée nulle ou indéterminée.")

    video_info = None
    if not video_streams:
        issues.append("Aucun flux vidéo détecté.")
    else:
        v = video_streams[0]
        fps = _parse_frame_rate(v.get("avg_frame_rate", "0/0")) or _parse_frame_rate(
            v.get("r_frame_rate", "0/0")
        )
        field_order = v.get("field_order", "unknown")
        video_info = {
            "codec": v.get("codec_name"),
            "codec_long": v.get("codec_long_name"),
            "width": v.get("width"),
            "height": v.get("height"),
            "fps": round(fps, 3),
            "pix_fmt": v.get("pix_fmt"),
            "field_order": field_order,
            "interlaced": field_order not in ("progressive", "unknown", None),
            "bit_rate": v.get("bit_rate"),
        }
        if fps and round(fps, 1) not in {25.0, 50.0, 12.5}:
            issues.append(
                f"Cadence image non standard pour la diffusion PAL ({fps:.2f} i/s, "
                f"attendu 25 ou 50 i/s)."
            )
        if v.get("codec_name") in (None, "", "unknown"):
            issues.append("Codec vidéo non identifié (probable codec manquant sur le serveur cible).")

    audio_info = []
    if not audio_streams:
        issues.append("Aucun flux audio détecté.")
    for a in audio_streams:
        audio_info.append({
            "codec": a.get("codec_name"),
            "channels": a.get("channels"),
            "sample_rate": a.get("sample_rate"),
            "bit_rate": a.get("bit_rate"),
        })
        if a.get("sample_rate") and int(a["sample_rate"]) != 48000:
            issues.append(
                f"Fréquence d'échantillonnage audio non standard ({a.get('sample_rate')} Hz, "
                f"attendu 48000 Hz)."
            )

    container = fmt.get("format_name")

    if issues:
        verdict = "a_risque"
    else:
        verdict = "ok"

    return {
        "path": str(path),
        "filename": path.name,
        "readable": True,
        "verdict": verdict,
        "issues": issues,
        "video": video_info,
        "audio": audio_info,
        "duration": duration,
        "container": container,
        "size_bytes": int(fmt.get("size", 0) or (path.stat().st_size if path.exists() else 0)),
    }


_BLACK_RE = re.compile(
    r"black_start:(?P<start>[\d.]+)\s+black_end:(?P<end>[\d.]+)\s+black_duration:(?P<dur>[\d.]+)"
)


def blackdetect_scan(ffmpeg_bin: str, path: Path, min_duration: float = 2.0) -> list[dict]:
    """Détecte les segments de noir prolongé (durée >= min_duration secondes)."""
    cmd = [
        ffmpeg_bin, "-nostdin", "-i", str(path),
        "-vf", f"blackdetect=d={min_duration}:pic_th=0.98",
        "-an", "-f", "null", "-",
    ]
    proc = _run(cmd, timeout=600)
    segments = []
    for match in _BLACK_RE.finditer(proc.stderr):
        segments.append({
            "start": float(match.group("start")),
            "end": float(match.group("end")),
            "duration": float(match.group("dur")),
        })
    return segments


def measure_loudness(ffmpeg_bin: str, path: Path, target_i=-23.0, target_lra=7.0, target_tp=-1.0) -> Optional[dict]:
    """Première passe loudnorm (EBU R128) : mesure les valeurs à réinjecter en 2e passe."""
    cmd = [
        ffmpeg_bin, "-nostdin", "-i", str(path),
        "-af", f"loudnorm=I={target_i}:LRA={target_lra}:TP={target_tp}:print_format=json",
        "-f", "null", "-",
    ]
    proc = _run(cmd, timeout=900)
    match = re.search(r"\{[^{}]*\"input_i\"[^{}]*\}", proc.stderr, re.DOTALL)
    if not match:
        return None
    try:
        return json.loads(match.group(0))
    except json.JSONDecodeError:
        return None


def build_ffmpeg_command(
    profile: Profile,
    input_path: Path,
    output_path: Path,
    *,
    deinterlace: bool = False,
    trim: Optional[tuple[float, float]] = None,
    loudness_measured: Optional[dict] = None,
    reset_timecode: bool = False,
    ffmpeg_bin: str = "ffmpeg",
) -> list[str]:
    cmd = [ffmpeg_bin, "-y", "-nostdin", "-hide_banner"]

    if trim:
        start, end = trim
        cmd += ["-ss", f"{start:.3f}"]
        if end and end > start:
            cmd += ["-to", f"{end:.3f}"]

    cmd += ["-i", str(input_path)]

    vfilters = []
    if deinterlace:
        vfilters.append("yadif")

    afilters = []
    if loudness_measured:
        i = loudness_measured.get("input_i", -23)
        lra = loudness_measured.get("input_lra", 7)
        tp = loudness_measured.get("input_tp", -1)
        thresh = loudness_measured.get("input_thresh", -34)
        offset = loudness_measured.get("target_offset", 0)
        afilters.append(
            "loudnorm=I=-23:LRA=7:TP=-1:"
            f"measured_I={i}:measured_LRA={lra}:measured_TP={tp}:"
            f"measured_thresh={thresh}:offset={offset}:linear=true:print_format=summary"
        )

    cmd += list(profile.video)
    if vfilters:
        cmd += ["-vf", ",".join(vfilters)]

    cmd += list(profile.audio)
    if afilters:
        cmd += ["-af", ",".join(afilters)]

    if reset_timecode:
        cmd += ["-timecode", "00:00:00:00"]

    cmd += list(profile.extra)
    cmd += [str(output_path)]
    return cmd


_TIME_RE = re.compile(r"out_time_ms=(\d+)")
_SPEED_RE = re.compile(r"speed=\s*([\d.]+)x")


def run_ffmpeg_with_progress(
    cmd: list[str],
    total_duration: float,
    on_progress: Callable[[float, str], None],
    should_cancel: Callable[[], bool] = lambda: False,
) -> tuple[int, str]:
    """Lance ffmpeg avec -progress pipe:1 et remonte la progression (0-100)."""
    cmd = cmd + ["-progress", "pipe:1", "-nostats"]
    proc = subprocess.Popen(
        cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        text=True, bufsize=1,
    )

    log_lines: list[str] = []
    last_pct = 0.0
    try:
        for line in proc.stdout:  # type: ignore[union-attr]
            log_lines.append(line.rstrip())
            if len(log_lines) > 400:
                log_lines.pop(0)

            m = _TIME_RE.search(line)
            if m and total_duration > 0:
                out_ms = int(m.group(1))
                pct = max(0.0, min(100.0, (out_ms / 1000.0) / total_duration * 100.0))
                last_pct = pct
                speed_m = _SPEED_RE.search(line)
                speed = speed_m.group(1) + "x" if speed_m else ""
                on_progress(pct, speed)

            if should_cancel():
                proc.terminate()
                time.sleep(0.5)
                if proc.poll() is None:
                    proc.kill()
                break
    finally:
        proc.wait()

    if proc.returncode == 0:
        on_progress(100.0, "")

    return proc.returncode, "\n".join(log_lines)
