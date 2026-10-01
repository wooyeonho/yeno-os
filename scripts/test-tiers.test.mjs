import test from 'node:test';
import assert from 'node:assert/strict';
import {partitionTests,selectChangedTier,parseTierArguments} from './test-tiers.mjs';

const files = [
  'runtime/test/drive-outcomes.test.mjs',
  'runtime/test/blackhole-core-server.test.mjs',
  'apps/controller/test/native-home.test.mjs',
  'scripts/native-config.test.mjs',
];

test('all existing test files belong to exactly one fast or integration tier and full retains both', () => {
  const {fast,integration,full} = partitionTests(files);
  assert.deepEqual(fast, ['runtime/test/drive-outcomes.test.mjs']);
  assert.deepEqual(integration, files.slice(1));
  assert.deepEqual(full, files);
  assert.equal(new Set([...fast,...integration]).size, full.length);
});

test('changed files choose the conservative tier and never downgrade a cross-cutting change', () => {
  assert.equal(selectChangedTier(['docs/BLACKHOLE_GOAL_CHARTER_20260930.md']), 'fast');
  assert.equal(selectChangedTier(['runtime/public/jarvis.mjs']), 'integration');
  assert.equal(selectChangedTier(['runtime/lib/drive-outcomes.mjs']), 'integration');
  assert.equal(selectChangedTier(['runtime/lib/store.mjs','docs/STATUS.json']), 'full');
  assert.equal(selectChangedTier(['scripts/run-tests.mjs']), 'full');
  assert.equal(selectChangedTier(['unknown-path']), 'full');
});

test('runner arguments select one tier, reject unknown flags and reject narrower explicit tier', () => {
  assert.deepEqual(parseTierArguments(['--tier=fast','--list']), {tier:'fast',changedFiles:[],list:true});
  assert.deepEqual(parseTierArguments(['--changed-file=runtime/server.mjs','--list']), {tier:'full',changedFiles:['runtime/server.mjs'],list:true});
  assert.throws(() => parseTierArguments(['--tier=fast','--changed-file=runtime/server.mjs']), /tier_too_narrow/);
  assert.throws(() => parseTierArguments(['--tier=quick']), /invalid_tier/);
  assert.throws(() => parseTierArguments(['--skip']), /unknown_argument/);
});
