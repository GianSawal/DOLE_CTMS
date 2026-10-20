FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1
ENV PYTHONUNBUFFERED=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    default-libmysqlclient-dev \
    build-essential \
    pkg-config \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# The TV's announcement voice (Piper "ljspeech", public domain). If the download fails the
# build still succeeds and the TV falls back to the browser's own voice.
ENV CTMS_TTS_VOICE=/app/voices/en_US-ljspeech-high.onnx
RUN mkdir -p /app/voices &&     (python -m piper.download_voices --download-dir /app/voices en_US-ljspeech-high      || echo "Announcement voice download failed; the TV will use the browser voice.")

COPY . .

RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3"]
