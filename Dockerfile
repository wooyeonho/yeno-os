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
COPY runtime/server.mjs runtime/package.json ./runtime/
COPY runtime/lib/ ./runtime/lib/
COPY runtime/public/ ./runtime/public/

# The existing interactive CLIs print the pairing token. Import the same runtime
# directly so credentials never enter the container startup log.
COPY <<'EOF' /opt/yeno/container-start.mjs
import fs from 'node:fs';
import { start } from './runtime/server.mjs';

process.umask(0o077);
let runtime;
let stopping = false;

function stop() {
  if (stopping) return;
  stopping = true;
  try {
    runtime?.shutdown();
    runtime?.server.closeAllConnections();
  } catch {
    console.error('YENO core shutdown failed; inspect the preserved data before restarting.');
    process.exitCode = 1;
  }
  setTimeout(() => process.exit(process.exitCode ?? 0), 250).unref();
}

try {
  if (process.env.YENO_TOKEN && process.env.YENO_TOKEN_FILE) {
    throw new Error('Set only one of YENO_TOKEN or YENO_TOKEN_FILE.');
  }
  const token = process.env.YENO_TOKEN ?? (process.env.YENO_TOKEN_FILE
    ? fs.readFileSync(process.env.YENO_TOKEN_FILE, 'utf8').trim()
    : undefined);
  if (!token || token.length < 16 || /[\r\n]/.test(token)) {
    throw new Error('Provide a single-line pairing token of at least 16 characters.');
  }
  runtime = await start({ token, containerLease: true });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
  console.log(`YENO core ready on port ${runtime.server.address().port}; pairing token logging is disabled.`);
} catch (error) {
  runtime?.shutdown();
  console.error(`YENO core startup failed: ${error.message}`);
  process.exitCode = 1;
}
EOF

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
ENTRYPOINT ["/bin/sh", "-c", "umask 077; exec flock --exclusive --nonblock --no-fork \"$YENO_DATA_DIR/.container-runtime.flock\" node /opt/yeno/container-start.mjs"]
