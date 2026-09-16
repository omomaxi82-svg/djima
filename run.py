#!/usr/bin/env python3
"""Point d'entrée de l'atelier de transcodage FFmpeg."""

import argparse

from app import create_app
from app.config import load_config


def main() -> None:
    parser = argparse.ArgumentParser(description="Atelier de transcodage FFmpeg pour ingest Cynergie")
    parser.add_argument("--config", default=None, help="Chemin vers config.yaml")
    args = parser.parse_args()

    config = load_config(args.config)
    app = create_app(config)
    app.run(host=config.host, port=config.port, threaded=True)


if __name__ == "__main__":
    main()
