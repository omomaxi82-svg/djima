from flask import Flask

from .config import Config
from .jobs import JobManager


def create_app(config: Config) -> Flask:
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = config.max_upload_mb * 1024 * 1024
    app.broadcast_config = config
    app.job_manager = JobManager(config)

    from .routes import bp

    app.register_blueprint(bp)
    return app
