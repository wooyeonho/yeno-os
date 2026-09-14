# Test image only; no source, data, model keys, GitHub token, or Docker socket.
FROM node:24-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg python3 python3-pil python3-fonttools fonts-nanum fonts-dejavu-core git ca-certificates \
    && rm -rf /var/lib/apt/lists/*
USER 1000:1000
WORKDIR /workspace
