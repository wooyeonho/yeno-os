import fs from 'node:fs';
import { start } from './server.mjs';
import { renderConfig } from './lib/render-config.mjs';
import { koyebConfig } from './lib/koyeb-config.mjs';
import { verifyHostedDisk } from './lib/hosted-disk.mjs';
import { INDEPENDENT_CORE_CONTRACT, assertIndependentCoreContract } from './lib/independent-core.mjs';

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
  // This assertion has no provider access. It protects the invariant that model
  // configuration is an optional bounded tool, never a boot dependency.
  assertIndependentCoreContract();
  const preflightRender = process.argv.includes('--preflight-render');
  const preflightKoyeb = process.argv.includes('--preflight-koyeb');
  const preflight = preflightRender || preflightKoyeb;
  let env = process.env, hosted;
  const onRender = preflightRender || env.RENDER === 'true';
  const onKoyeb = preflightKoyeb || Boolean(env.KOYEB_SERVICE_ID);
  if (onRender && onKoyeb) throw new Error('Choose exactly one hosted platform configuration.');
  if (onRender || onKoyeb) {
    hosted = onRender ? renderConfig(env) : koyebConfig(env);
    verifyHostedDisk(hosted);
    env = hosted.env;
  }
  if (env.YENO_TOKEN && env.YENO_TOKEN_FILE) throw new Error('Set only one of YENO_TOKEN or YENO_TOKEN_FILE.');
  const token = env.YENO_TOKEN ?? (env.YENO_TOKEN_FILE ? fs.readFileSync(env.YENO_TOKEN_FILE, 'utf8').trim() : undefined);
  if (!token || token.length < 16 || /[\r\n]/.test(token)) throw new Error('Provide a single-line pairing token of at least 16 characters.');
  if (preflight) {
    // The mounted disk was verified before creating anything. Never mkdir the
    // mount point itself: that would hide a missing disk on an ephemeral host.
    fs.mkdirSync(hosted.dataDir, { recursive: true, mode: 0o700 });
    fs.accessSync(hosted.dataDir, fs.constants.W_OK | fs.constants.X_OK);
  } else {
    runtime = await start({ token, env, containerLease: true });
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, stop);
    console.log(`BLACKHOLE ${INDEPENDENT_CORE_CONTRACT.mode} core active; model providers are optional bounded tools.`);
    console.log(`YENO core ready on port ${runtime.server.address().port}; pairing token logging is disabled.`);
  }
} catch (error) {
  runtime?.shutdown();
  console.error(`YENO core startup failed: ${error.message}`);
  process.exitCode = 1;
}
