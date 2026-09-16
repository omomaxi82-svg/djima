import os
from pathlib import Path

import yaml

DEFAULTS = {
    "input_dir": "./watch/in",
    "output_dir": "./watch/out",
    "archive_dir": "",
    "ffmpeg_bin": "ffmpeg",
    "ffprobe_bin": "ffprobe",
    "max_parallel_jobs": 1,
    "host": "0.0.0.0",
    "port": 8090,
    "max_upload_mb": 20000,
}

ENV_OVERRIDES = {
    "input_dir": "INPUT_DIR",
    "output_dir": "OUTPUT_DIR",
    "archive_dir": "ARCHIVE_DIR",
    "ffmpeg_bin": "FFMPEG_BIN",
    "ffprobe_bin": "FFPROBE_BIN",
    "max_parallel_jobs": "MAX_PARALLEL_JOBS",
    "host": "HOST",
    "port": "PORT",
    "max_upload_mb": "MAX_UPLOAD_MB",
}


class Config:
    def __init__(self, data: dict):
        self._data = data
        self.input_dir = Path(data["input_dir"]).resolve()
        self.output_dir = Path(data["output_dir"]).resolve()
        archive_dir = data.get("archive_dir") or ""
        self.archive_dir = Path(archive_dir).resolve() if archive_dir else None
        self.ffmpeg_bin = data["ffmpeg_bin"]
        self.ffprobe_bin = data["ffprobe_bin"]
        self.max_parallel_jobs = int(data["max_parallel_jobs"])
        self.host = data["host"]
        self.port = int(data["port"])
        self.max_upload_mb = int(data["max_upload_mb"])

        self.input_dir.mkdir(parents=True, exist_ok=True)
        self.output_dir.mkdir(parents=True, exist_ok=True)
        if self.archive_dir:
            self.archive_dir.mkdir(parents=True, exist_ok=True)


def load_config(path: str | None = None) -> Config:
    data = dict(DEFAULTS)

    candidate_paths = [path] if path else ["config.yaml", "config.yml"]
    for candidate in candidate_paths:
        if candidate and os.path.isfile(candidate):
            with open(candidate, "r", encoding="utf-8") as f:
                loaded = yaml.safe_load(f) or {}
            data.update({k: v for k, v in loaded.items() if v is not None})
            break

    for key, env_name in ENV_OVERRIDES.items():
        if env_name in os.environ:
            data[key] = os.environ[env_name]

    return Config(data)
