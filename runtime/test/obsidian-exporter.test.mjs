import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  loadObsidianConfig, exportEvent, exportGenerated, renderEventMarkdown, renderIdentityMarkdown,
  renderCurrentStateMarkdown, renderMemoryIndexMarkdown, renderSyncStatusMarkdown, memoryIndexCounts,
  eventRelativeSegments, EVENT_TYPE_FOLDERS,
} from '../lib/obsidian-exporter.mjs';
import {createMemoryEvent} from '../lib/memory-events.mjs';
import {outboxSummary} from '../lib/memory-sync-outbox.mjs';

// BLACKHOLE Obsidian exporter (Phase B) — one-way, human-readable mirror.
// Every test uses a real temp directory standing in for the owner's vault
// (never a real vault) so the safety and conflict-preservation guarantees
// are exercised against a genuine filesystem, not a mock.

function tempVault() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-exporter-test-'));
}
const at = () => new Date().toISOString();
function memoryEvent(overrides = {}) {
  const state = {projects: [], quests: [], memoryEvents: []};
  return createMemoryEvent({type: 'episode', text: 'An episode.', confidence: 0.7, projectId: null, questId: null, sourceRefs: [], ...overrides}, state, {at: at()});
}
const core = {identity: {id: '11111111-1111-4111-8111-111111111111', name: 'BLACKHOLE', createdAt: at()}};

test('loadObsidianConfig is disabled by default and rejects a non-absolute or missing vault path', () => {
  assert.equal(loadObsidianConfig({}).enabled, false);
  assert.equal(loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: 'relative/path'}).configError, 'vault_path_not_absolute');
  assert.equal(loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: '/definitely/does/not/exist/xyz'}).configError, 'vault_unavailable');
});

test('loadObsidianConfig accepts a real directory and resolves it to its real path', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  assert.equal(config.enabled, true);
  assert.equal(config.vaultRoot, fs.realpathSync(vault));
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportEvent writes a new event to a deterministic path under BLACKHOLE/, readable markdown, never raw JSON', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const e = memoryEvent({text: 'The owner shipped Phase B today.'});
  const result = exportEvent(config, e, {core}, at());
  assert.equal(result.result, 'synced');
  const segments = eventRelativeSegments(e);
  assert.equal(result.relativePath, path.join('BLACKHOLE', ...segments));
  const content = fs.readFileSync(path.join(vault, 'BLACKHOLE', ...segments), 'utf8');
  assert.match(content, /generated: true/);
  assert.match(content, new RegExp(`fingerprint: ${e.fingerprint}`));
  assert.match(content, /# Episode/);
  assert.match(content, /The owner shipped Phase B today\./);
  assert.equal(content.includes('{'), false, 'exported memory must be readable markdown, never raw JSON');
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportEvent re-exporting the identical event is a true idempotent no-op: no second write, no pending file', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const e = memoryEvent({text: 'idempotent export'});
  exportEvent(config, e, {core}, at());
  const segments = eventRelativeSegments(e);
  const before = fs.statSync(path.join(vault, 'BLACKHOLE', ...segments)).mtimeMs;
  const second = exportEvent(config, e, {core}, at());
  assert.equal(second.result, 'synced');
  const files = fs.readdirSync(path.join(vault, 'BLACKHOLE', ...segments.slice(0, -1)));
  assert.equal(files.length, 1, 'a real no-op must never create a pending sibling file');
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportEvent leaves an owner-appended note in a matching-fingerprint file completely untouched (a real no-op never rewrites the file)', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const e = memoryEvent({text: 'original content'});
  exportEvent(config, e, {core}, at());
  const segments = eventRelativeSegments(e);
  const absolute = path.join(vault, 'BLACKHOLE', ...segments);
  const original = fs.readFileSync(absolute, 'utf8');
  fs.writeFileSync(absolute, original + '\n\nThe owner added their own note here.\n');
  const result = exportEvent(config, e, {core}, at());
  assert.equal(result.result, 'synced', 'the frontmatter fingerprint still matches the event, so this is a real no-op');
  const afterReexport = fs.readFileSync(absolute, 'utf8');
  assert.match(afterReexport, /The owner added their own note here\./, 'a no-op must never touch the file, so the owner note survives untouched');
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportEvent detects a file whose recorded fingerprint disagrees with the event as a conflict and preserves BOTH sides, never overwrites', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const e = memoryEvent({text: 'original content'});
  exportEvent(config, e, {core}, at());
  const segments = eventRelativeSegments(e);
  const absolute = path.join(vault, 'BLACKHOLE', ...segments);
  const original = fs.readFileSync(absolute, 'utf8');
  const tampered = original.replace(/fingerprint: [a-f0-9]{64}/, `fingerprint: ${'a'.repeat(64)}`) + '\n\nThe owner rewrote this entry entirely.\n';
  fs.writeFileSync(absolute, tampered);
  const result = exportEvent(config, e, {core}, at());
  assert.equal(result.result, 'blocked');
  assert.equal(result.errorCode, 'fingerprint_mismatch');
  const afterOwnerEdit = fs.readFileSync(absolute, 'utf8');
  assert.match(afterOwnerEdit, /The owner rewrote this entry entirely\./, 'the owner edit must never be silently destroyed');
  const dir = path.dirname(absolute);
  const pendingFiles = fs.readdirSync(dir).filter(f => f.includes('.pending-'));
  assert.equal(pendingFiles.length, 1, 'the new content must be preserved alongside, never dropped');
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportEvent never writes outside the BLACKHOLE subtree even given an adversarial event id, and mutates nothing on failure', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const e = {...memoryEvent(), id: '../../../../etc/passwd'};
  const result = exportEvent(config, e, {core}, at());
  assert.equal(result.result, 'blocked');
  assert.equal(fs.existsSync('/etc/passwd.md'), false);
  assert.equal(fs.existsSync(path.join(vault, '..', 'etc')), false);
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportEvent rejects a symlink swapped in for the BLACKHOLE root after creation, never following it out of the vault', () => {
  const vault = tempVault();
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'obsidian-outside-'));
  fs.mkdirSync(path.join(vault, 'BLACKHOLE'));
  fs.rmdirSync(path.join(vault, 'BLACKHOLE'));
  fs.symlinkSync(outside, path.join(vault, 'BLACKHOLE'));
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const e = memoryEvent();
  const result = exportEvent(config, e, {core}, at());
  assert.equal(result.result, 'blocked');
  assert.equal(result.errorCode, 'vault_conflict');
  assert.equal(fs.readdirSync(outside).length, 0, 'nothing may be written through a symlink escape');
  fs.rmSync(vault, {recursive: true, force: true});
  fs.rmSync(outside, {recursive: true, force: true});
});

test('exportEvent never exports outside the disabled state, and reports not_configured without touching disk', () => {
  const config = loadObsidianConfig({});
  const result = exportEvent(config, memoryEvent(), {core}, at());
  assert.equal(result.result, 'failed');
  assert.equal(result.errorCode, 'not_configured');
});

test('renderEventMarkdown never includes a secret-shaped value even if a caller tried to smuggle one into context', () => {
  const e = memoryEvent({text: 'ok text'});
  const md = renderEventMarkdown(e, {core});
  assert.equal(/sk-[A-Za-z0-9]{10,}/.test(md), false);
  assert.equal(/ghp_[A-Za-z0-9]{10,}/.test(md), false);
  assert.equal(/BEGIN (RSA |EC )?PRIVATE KEY/.test(md), false);
});

test('every canonical memory event type maps to a real export folder, so eventRelativeSegments never fails at export time', () => {
  for (const type of Object.keys(EVENT_TYPE_FOLDERS)) {
    const e = memoryEvent({type});
    const [folder] = eventRelativeSegments(e);
    assert.equal(folder, EVENT_TYPE_FOLDERS[type]);
  }
});

// --- Recurring dashboard/index files (Identity, Current State, Memory
// Index, Sync Status): these are machine-owned and expected to change
// legitimately whenever the underlying state changes - freely overwritten,
// but never at the cost of a genuinely foreign file at the same path.

test('exportGenerated freely overwrites a dashboard file it already owns when the content legitimately changes', () => {
  const vault = tempVault();
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const first = renderCurrentStateMarkdown({identity: core.identity, activity: 'idle', mission: null, dominantDriveName: null, activeShadowCount: 0}, at(), 'digest-one');
  const r1 = exportGenerated(config, ['00_Core', 'Current_State.md'], first, at());
  assert.equal(r1.result, 'synced');
  const second = renderCurrentStateMarkdown({identity: core.identity, activity: 'working', mission: null, dominantDriveName: null, activeShadowCount: 1}, at(), 'digest-two');
  const r2 = exportGenerated(config, ['00_Core', 'Current_State.md'], second, at());
  assert.equal(r2.result, 'synced');
  const onDisk = fs.readFileSync(path.join(vault, 'BLACKHOLE', '00_Core', 'Current_State.md'), 'utf8');
  assert.match(onDisk, /\*\*Activity:\*\* working/);
  const files = fs.readdirSync(path.join(vault, 'BLACKHOLE', '00_Core'));
  assert.equal(files.filter(f => f.includes('.pending-')).length, 0, 'a legitimate dashboard content change must never look like a conflict');
  fs.rmSync(vault, {recursive: true, force: true});
});

test('exportGenerated still blocks and preserves a genuinely foreign (non-generated) file at a dashboard path', () => {
  const vault = tempVault();
  fs.mkdirSync(path.join(vault, 'BLACKHOLE', '00_Core'), {recursive: true});
  fs.writeFileSync(path.join(vault, 'BLACKHOLE', '00_Core', 'Identity.md'), '# My own notes\nNothing to do with BLACKHOLE.\n');
  const config = loadObsidianConfig({YENO_OBSIDIAN_EXPORT_ENABLED: 'true', YENO_OBSIDIAN_VAULT_PATH: vault});
  const content = renderIdentityMarkdown(core, 'digest');
  const result = exportGenerated(config, ['00_Core', 'Identity.md'], content, at());
  assert.equal(result.result, 'blocked');
  assert.equal(result.errorCode, 'vault_conflict');
  const owner = fs.readFileSync(path.join(vault, 'BLACKHOLE', '00_Core', 'Identity.md'), 'utf8');
  assert.match(owner, /My own notes/, 'a foreign file at a dashboard path must never be overwritten');
  fs.rmSync(vault, {recursive: true, force: true});
});

test('memoryIndexCounts is the same stable source both the renderer and any caller-side fingerprint must use', () => {
  const events = [memoryEvent({type: 'episode'}), memoryEvent({type: 'episode'}), memoryEvent({type: 'decision'})];
  const counts = memoryIndexCounts(events);
  assert.equal(counts.episode, 2);
  assert.equal(counts.decision, 1);
  assert.equal(counts.skill, 0);
  const md = renderMemoryIndexMarkdown(events, at(), 'digest');
  assert.match(md, /Episode: 2/);
  assert.match(md, /Decision: 1/);
});

test('renderSyncStatusMarkdown never leaks a URL, service key, vault path or raw error - only bounded counts', () => {
  const outbox = [];
  const md = renderSyncStatusMarkdown(outboxSummary(outbox, 'supabase'), outboxSummary(outbox, 'obsidian'), at(), 'digest');
  assert.equal(/https?:\/\//.test(md), false);
  assert.equal(/\/home\/|\/Users\//.test(md), false);
  assert.match(md, /synced.*pending.*failed.*blocked/s);
});
