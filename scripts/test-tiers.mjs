import {readdirSync} from 'node:fs';
import {join} from 'node:path';

// These tests exercise bounded, mostly pure contracts. A test not listed here
// remains in integration; full is always the union, never a reduced suite.
export const FAST_TESTS = Object.freeze([
  'runtime/test/absorb-inbox.test.mjs',
  'runtime/test/blackhole-core.test.mjs',
  'runtime/test/cost-ledger.test.mjs',
  'runtime/test/decide.test.mjs',
  'runtime/test/drive-orbit-model.test.mjs',
  'runtime/test/drive-outcomes.test.mjs',
  'runtime/test/drive-state.test.mjs',
  'runtime/test/drive-voice-v2.test.mjs',
  'runtime/test/gap-scout.test.mjs',
  'runtime/test/jev-docket.test.mjs',
  'runtime/test/kirby-copy.test.mjs',
  'runtime/test/lust-mirror.test.mjs',
  'runtime/test/quantum-decision.test.mjs',
  'runtime/test/repository-evidence.test.mjs',
  'runtime/test/seven-drives.test.mjs',
  'runtime/test/shadow-arise.test.mjs',
  'runtime/test/task-routing.test.mjs',
  'scripts/test-tiers.test.mjs',
  'scripts/status-from-log.test.mjs',
]);

const normalize = value => value.replaceAll('\\','/').replace(/^\.\//,'');
const priority = Object.freeze({fast:0,integration:1,full:2});

export function discoverTests(root = '.') {
  const inDirectory = directory => readdirSync(join(root,directory),{withFileTypes:true})
    .filter(item => item.isFile() && item.name.endsWith('.test.mjs'))
    .map(item => `${directory}/${item.name}`);
  return [
    ...inDirectory('runtime/test'),
    ...inDirectory('apps/controller/test'),
    'scripts/native-config.test.mjs',
    'scripts/android-release.test.mjs',
    'scripts/test-tiers.test.mjs',
    'scripts/status-from-log.test.mjs',
  ].sort();
}

export function partitionTests(paths) {
  const full = paths.map(normalize);
  if (new Set(full).size !== full.length) throw new Error('duplicate_test_path');
  const fastSet = new Set(FAST_TESTS);
  const fast = full.filter(path => fastSet.has(path));
  const integration = full.filter(path => !fastSet.has(path));
  return {fast,integration,full};
}

export function selectChangedTier(paths) {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('changed_files_required');
  let selected = 'fast';
  for (const raw of paths) {
    const path = normalize(raw);
    let tier = 'full';
    if (path.startsWith('docs/') || path.endsWith('.md')) tier = 'fast';
    else if (path === 'scripts/run-tests.mjs' || path === 'scripts/test-tiers.mjs' || path === 'runtime/server.mjs' || path === 'runtime/lib/store.mjs' || path === 'runtime/lib/backup.mjs') tier = 'full';
    else if (FAST_TESTS.includes(path)) tier = 'fast';
    else if (path.startsWith('runtime/') || path.startsWith('apps/controller/') || path.startsWith('workers/developer/') || path.startsWith('scripts/')) tier = 'integration';
    if (priority[tier] > priority[selected]) selected = tier;
  }
  return selected;
}

export function parseTierArguments(argv) {
  let explicit = null, list = false;
  const changedFiles = [];
  for (const arg of argv) {
    if (arg.startsWith('--tier=')) {
      const value = arg.slice('--tier='.length);
      if (!Object.hasOwn(priority,value)) throw new Error('invalid_tier');
      if (explicit !== null) throw new Error('duplicate_tier');
      explicit = value;
    } else if (arg.startsWith('--changed-file=')) {
      const value = arg.slice('--changed-file='.length);
      if (!value) throw new Error('changed_file_empty');
      changedFiles.push(value);
    } else if (arg === '--list') list = true;
    else throw new Error(`unknown_argument:${arg}`);
  }
  const needed = changedFiles.length ? selectChangedTier(changedFiles) : 'full';
  if (explicit && changedFiles.length && priority[explicit] < priority[needed]) throw new Error('tier_too_narrow');
  return {tier:explicit??needed,changedFiles,list};
}
