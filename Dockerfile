FROM python:3.11-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /opt/transcoder

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY run.py ./run.py
COPY config.example.yaml ./config.example.yaml

RUN mkdir -p /data/in /data/out /data/archive

ENV INPUT_DIR=/data/in \
    OUTPUT_DIR=/data/out \
    ARCHIVE_DIR=/data/archive \
    HOST=0.0.0.0 \
    PORT=8090

EXPOSE 8090

CMD ["python", "run.py"]
