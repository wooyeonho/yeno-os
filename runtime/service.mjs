import fs from 'node:fs';
import { start } from './server.mjs';
import { renderConfig, verifyRenderDisk } from './lib/render-config.mjs';

// Shared non-interactive entrypoint. Do not run server.mjs as a CLI on a hosted
// service: that development entrypoint intentionally prints the pairing token.
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
  const preflight = process.argv.includes('--preflight-render');
  let env = process.env, render;
  if (preflight || env.RENDER === 'true') {
    render = renderConfig(env);
    verifyRenderDisk(render);
    env = render.env;
  }
  if (env.YENO_TOKEN && env.YENO_TOKEN_FILE) throw new Error('Set only one of YENO_TOKEN or YENO_TOKEN_FILE.');
  const token = env.YENO_TOKEN ?? (env.YENO_TOKEN_FILE ? fs.readFileSync(env.YENO_TOKEN_FILE, 'utf8').trim() : undefined);
  if (!token || token.length < 16 || /[\r\n]/.test(token)) throw new Error('Provide a single-line pairing token of at least 16 characters.');
  if (preflight) {
    // The mounted disk was verified before creating anything. Never mkdir the
    // mount point itself: that would hide a missing disk on an ephemeral host.
    fs.mkdirSync(render.dataDir, { recursive: true, mode: 0o700 });
    fs.accessSync(render.dataDir, fs.constants.W_OK | fs.constants.X_OK);
  } else {
    runtime = await start({ token, env, containerLease: true });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
    console.log(`YENO core ready on port ${runtime.server.address().port}; pairing token logging is disabled.`);
  }
} catch (error) {
  runtime?.shutdown();
  console.error(`YENO core startup failed: ${error.message}`);
  process.exitCode = 1;
}
