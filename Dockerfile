# syntax=docker/dockerfile:1
FROM node:24-bookworm-slim

# flock provides an OS-held single-writer guard across container PID namespaces.
RUN apt-get update \
    && apt-get install -y --no-install-recommends util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /opt/yeno/runtime /var/lib/yeno \
    && chown node:node /var/lib/yeno \
    && chmod 0700 /var/lib/yeno

WORKDIR /opt/yeno
COPY runtime/server.mjs runtime/service.mjs runtime/package.json ./runtime/
COPY runtime/lib/ ./runtime/lib/
COPY runtime/public/ ./runtime/public/

ENV NODE_ENV=production \
    YENO_HOST=0.0.0.0 \
    YENO_PORT=8790 \
    YENO_DATA_DIR=/var/lib/yeno

USER node:node
EXPOSE 8790
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ["node", "--input-type=module", "-e", "try { const r = await fetch('http://127.0.0.1:' + (process.env.YENO_PORT || '8790') + '/api/v1/health', { signal: AbortSignal.timeout(3000), redirect: 'error' }); const h = await r.json(); if (!r.ok || h.name !== 'YENO OS' || h.apiVersion !== '1' || h.authRequired !== true) process.exit(1); } catch { process.exit(1); }"]

# Keep this inode: unlinking it defeats flock. Container mode verifies this
# inherited kernel lock and refuses any legacy runtime.lock before opening data.
ENTRYPOINT ["/bin/sh", "-c", "umask 077; exec flock --exclusive --nonblock --no-fork \"$YENO_DATA_DIR/.container-runtime.flock\" node /opt/yeno/runtime/service.mjs"]
