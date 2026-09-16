from __future__ import annotations

import itertools
import queue
import shutil
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional

from . import ffmpeg_utils
from .config import Config
from .profiles import get_profile

_STATUS_ORDER = ["en_attente", "analyse", "mesure_loudness", "encodage", "verification", "termine", "erreur", "annule"]


@dataclass
class Job:
    id: str
    filename: str
    profile_id: str
    options: dict
    status: str = "en_attente"
    progress: float = 0.0
    phase: str = "En attente"
    speed: str = ""
    error: Optional[str] = None
    output_filename: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    started_at: Optional[float] = None
    finished_at: Optional[float] = None
    log_tail: str = ""
    analysis: Optional[dict] = None
    post_check: Optional[dict] = None
    cancel_requested: bool = False

    def to_dict(self) -> dict:
        d = {k: v for k, v in self.__dict__.items() if k != "cancel_requested"}
        return d


class JobManager:
    def __init__(self, config: Config):
        self.config = config
        self._jobs: dict[str, Job] = {}
        self._order: list[str] = []
        self._lock = threading.RLock()
        self._executor = ThreadPoolExecutor(max_workers=max(1, config.max_parallel_jobs))
        self._subscribers: list[queue.Queue] = []
        self._id_counter = itertools.count(1)

    # -- pub/sub for SSE -----------------------------------------------
    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue()
        with self._lock:
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def _publish(self, job: Job) -> None:
        with self._lock:
            subs = list(self._subscribers)
        for q in subs:
            q.put(job.to_dict())

    # -- job lifecycle ----------------------------------------------------
    def submit(self, filename: str, profile_id: str, options: dict) -> Job:
        get_profile(profile_id)  # validation, lève KeyError si inconnu
        job_id = uuid.uuid4().hex[:12]
        job = Job(id=job_id, filename=filename, profile_id=profile_id, options=options or {})
        with self._lock:
            self._jobs[job_id] = job
            self._order.append(job_id)
        self._publish(job)
        self._executor.submit(self._run_job, job_id)
        return job

    def get(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def list_jobs(self) -> list[dict]:
        with self._lock:
            ids = list(reversed(self._order))
            return [self._jobs[i].to_dict() for i in ids]

    def cancel(self, job_id: str) -> bool:
        with self._lock:
            job = self._jobs.get(job_id)
            if not job or job.status in ("termine", "erreur", "annule"):
                return False
            job.cancel_requested = True
        return True

    # -- worker -------------------------------------------------------
    def _update(self, job: Job, **kwargs) -> None:
        for k, v in kwargs.items():
            setattr(job, k, v)
        self._publish(job)

    def _run_job(self, job_id: str) -> None:
        job = self.get(job_id)
        if job is None:
            return

        input_path = self.config.input_dir / job.filename
        profile = get_profile(job.profile_id)
        opts = job.options

        job.started_at = time.time()

        try:
            if not input_path.is_file():
                raise FileNotFoundError(f"Fichier source introuvable : {job.filename}")

            self._update(job, status="analyse", phase="Analyse du fichier source", progress=0)
            analysis = ffmpeg_utils.analyze_file(self.config.ffprobe_bin, input_path)
            job.analysis = analysis
            duration = analysis.get("duration") or 0.0
            if not analysis.get("readable"):
                raise RuntimeError("Fichier source illisible / corrompu, transcodage impossible.")

            trim = None
            if opts.get("trim_black") and duration > 0:
                self._update(job, phase="Détection des plans noirs")
                segments = ffmpeg_utils.blackdetect_scan(self.config.ffmpeg_bin, input_path)
                start = 0.0
                end = duration
                if segments and segments[0]["start"] <= 0.5:
                    start = segments[0]["end"]
                if segments and segments[-1]["end"] >= duration - 0.5:
                    end = segments[-1]["start"]
                if start > 0.0 or end < duration:
                    trim = (start, end)

            loud_measured = None
            if opts.get("normalize_loudness"):
                self._update(job, status="mesure_loudness", phase="Mesure de la loudness (EBU R128, passe 1/2)")
                loud_measured = ffmpeg_utils.measure_loudness(self.config.ffmpeg_bin, input_path)

            if job.cancel_requested:
                self._update(job, status="annule", phase="Annulé avant encodage")
                return

            output_ext = profile.container
            base_name = Path(job.filename).stem
            output_filename = f"{base_name}__{profile.id}.{output_ext}"
            output_path = self.config.output_dir / output_filename

            cmd = ffmpeg_utils.build_ffmpeg_command(
                profile, input_path, output_path,
                deinterlace=bool(opts.get("deinterlace")),
                trim=trim,
                loudness_measured=loud_measured,
                reset_timecode=bool(opts.get("reset_timecode")),
                ffmpeg_bin=self.config.ffmpeg_bin,
            )

            self._update(job, status="encodage", phase=f"Encodage vers {profile.label}", progress=0)

            def on_progress(pct: float, speed: str) -> None:
                self._update(job, progress=round(pct, 1), speed=speed)

            returncode, log_tail = ffmpeg_utils.run_ffmpeg_with_progress(
                cmd, duration, on_progress, should_cancel=lambda: job.cancel_requested
            )
            job.log_tail = log_tail

            if job.cancel_requested:
                if output_path.exists():
                    output_path.unlink(missing_ok=True)
                self._update(job, status="annule", phase="Annulé par l'opérateur")
                return

            if returncode != 0 or not output_path.exists():
                raise RuntimeError(f"ffmpeg a échoué (code {returncode}). Voir le journal.")

            self._update(job, status="verification", phase="Vérification du fichier généré", progress=100)
            post_check = ffmpeg_utils.analyze_file(self.config.ffprobe_bin, output_path)
            job.post_check = post_check
            job.output_filename = output_filename

            if not post_check.get("readable"):
                raise RuntimeError("Le fichier généré n'a pas pu être relu par ffprobe : rejeter ce résultat.")

            if self.config.archive_dir:
                try:
                    shutil.move(str(input_path), str(self.config.archive_dir / job.filename))
                except OSError:
                    pass

            self._update(job, status="termine", phase="Terminé", progress=100, finished_at=time.time())

        except Exception as exc:  # noqa: BLE001
            self._update(
                job, status="erreur", phase="Erreur", error=str(exc), finished_at=time.time()
            )
