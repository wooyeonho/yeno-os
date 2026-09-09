import fs from 'node:fs';
import path from 'node:path';
import {isMainThread} from 'node:worker_threads';

export const CONTAINER_GUARD = '.container-runtime.flock';
const claimedGuards = new Set();

function existsWithoutFollowingLinks(file) {
  try { fs.lstatSync(file); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

// The permanent guard also marks a container-owned directory. The ordinary PID
// lock checks this before and after its own exclusive creation to close the race
// with a container starting at the same time.
export function assertStandaloneDirectory(directory) {
  if (existsWithoutFollowingLinks(path.join(directory, CONTAINER_GUARD))) {
    throw new Error('This data directory requires the verified container lease; use the packaged entrypoint.');
  }
}

function guardStat(file) {
  const stat = fs.lstatSync(file, { bigint: true });
  if (!stat.isFile() || stat.nlink !== 1n) {
    throw new Error('Container lease guard must be a regular file with one link.');
  }
  return stat;
}

// Only the inherited, kernel-held flock can authorize this mode. An option or
// environment variable alone is never proof of ownership. See Linux proc(5)
// fdinfo: lock lines belong to the open file description and survive exec.
export function acquireContainerLease(directory) {
  if (process.platform !== 'linux') throw new Error('Container leases require Linux procfs.');
  if (!isMainThread) throw new Error('Container leases may only be claimed by the main thread.');
  const file = path.join(directory, CONTAINER_GUARD);
  const expected = guardStat(file);
  const key = `${expected.dev}:${expected.ino}`;
  if (claimedGuards.has(key)) throw new Error('This process already claimed the container lease.');

  // A procfs mount can expose an ancestor PID namespace. Its status and fdinfo
  // use that mount's PID numbering, which can differ from process.pid.
  const pid = fs.readFileSync('/proc/self/status', 'utf8').match(/^Pid:\s+(\d+)$/m)?.[1];
  if (!pid) throw new Error('Cannot verify the container lease owner through procfs.');
  let verified = false;
  for (const name of fs.readdirSync('/proc/self/fdinfo')) {
    if (!/^\d+$/.test(name) || Number(name) < 3) continue;
    try {
      const descriptor = fs.fstatSync(Number(name), { bigint: true });
      if (!descriptor.isFile() || descriptor.dev !== expected.dev || descriptor.ino !== expected.ino) continue;
      const info = fs.readFileSync(`/proc/self/fdinfo/${name}`, 'utf8');
      for (const line of info.split('\n')) {
        const lock = line.match(/^lock:\s+\d+:\s+FLOCK\s+ADVISORY\s+WRITE\s+(\d+)\s+[\da-f]+:[\da-f]+:(\d+)\s+0\s+EOF\s*$/i);
        if (lock && lock[1] === pid && BigInt(lock[2]) === expected.ino) verified = true;
      }
      if (verified) break;
    } catch (error) {
      // Descriptors may disappear while procfs is enumerated. An inaccessible or
      // changed descriptor never counts as verified ownership.
      if (!['ENOENT', 'EBADF', 'EACCES'].includes(error.code)) throw error;
    }
  }
  if (!verified) throw new Error('An inherited exclusive container flock could not be verified.');
  const current = guardStat(file);
  if (current.dev !== expected.dev || current.ino !== expected.ino) {
    throw new Error('Container lease guard changed during verification.');
  }
  if (existsWithoutFollowingLinks(path.join(directory, 'runtime.lock'))) {
    throw new Error('A legacy runtime.lock remains; stop all writers and preserve a backup before manual migration.');
  }
  claimedGuards.add(key);

  // The entrypoint owns this FD for the whole process lifetime. Do not close or
  // unlink it during shutdown/startup failure: a still-draining request must not
  // overlap a new writer. The kernel releases it even after SIGKILL. A process
  // must exit before it can start another container core with this same guard.
  return () => {};
}
