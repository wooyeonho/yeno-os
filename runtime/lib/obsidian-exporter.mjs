import fs from 'node:fs';
import path from 'node:path';
import {atomicWrite} from './store.mjs';

// BLACKHOLE Obsidian exporter (Phase B) — a one-way, human-readable mirror of
// canonical BLACKHOLE memory. Obsidian is never a source of truth and there
// is no bidirectional import in this phase: this module only ever turns an
// already-validated local Memory Event (or Core identity/state) into
// Markdown inside a vault the owner configures.
//
// Conflict policy A from the Phase B kickoff: this exporter fully owns a
// dedicated `BLACKHOLE/` subtree and every file inside it carries
// `generated: true` frontmatter plus the exact fingerprint of what produced
// it. A write only ever happens when the target path doesn't exist yet, or
// exists with the exact same fingerprint (a true no-op re-export). Anything
// else - a foreign file, a hand-edited generated file, a stale fingerprint -
// is a conflict: nothing is overwritten, the new content is preserved
// alongside the old under a `.pending-<timestamp>.md` sibling, and the
// caller records a blocked sync receipt.
export const OBSIDIAN_EXPORT_VERSION = 1;
export const EVENT_TYPE_FOLDERS = Object.freeze({
  relationship: '10_Relationship', episode: '30_Episodes', decision: '40_Decisions',
  skill: '50_Skills', source: '70_Research', project: '80_Projects', result: '90_Growth',
});
const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,120}$/;
const FINGERPRINT_LINE = /^fingerprint:\s*(\S+)\s*$/m;
const GENERATED_LINE = /^generated:\s*true\s*$/m;

export class ObsidianExportError extends Error {
  constructor(message, code = 'OBSIDIAN_EXPORT_INVALID') {super(message); this.code = code;}
}
const fail = (message, code) => {throw new ObsidianExportError(message, code);};

// Disabled by default; a missing/invalid vault path never silently exports
// anywhere, it just stays disabled. The vault root is resolved to its real
// path once here (following any symlink on the configured path itself) so
// every later write can be checked against that one fixed real root.
export function loadObsidianConfig(env) {
  const disabled = {enabled: false, vaultRoot: null, configError: null};
  if (env.YENO_OBSIDIAN_EXPORT_ENABLED !== 'true') return disabled;
  const configuredPath = env.YENO_OBSIDIAN_VAULT_PATH ?? '';
  if (!configuredPath || !path.isAbsolute(configuredPath)) return {...disabled, configError: 'vault_path_not_absolute'};
  let real;
  try {real = fs.realpathSync(configuredPath);} catch {return {...disabled, configError: 'vault_unavailable'};}
  let stat;
  try {stat = fs.lstatSync(real);} catch {return {...disabled, configError: 'vault_unavailable'};}
  if (!stat.isDirectory()) return {...disabled, configError: 'vault_not_directory'};
  return {enabled: true, vaultRoot: real, configError: null};
}

// Every path this module ever writes to is built ONLY from these validated,
// deterministic segments - never from free-text memory content - and the
// final resolved real directory is re-checked to still be inside the vault's
// real BLACKHOLE root before any write, so a symlink swapped in after
// mkdir cannot redirect a write outside the owned subtree.
function resolveInVault(vaultRoot, segments) {
  for (const segment of segments) if (typeof segment !== 'string' || !SAFE_SEGMENT.test(segment) || segment === '.' || segment === '..') fail(`Unsafe vault path segment: ${String(segment)}`, 'vault_conflict');
  const blackholeRoot = path.join(vaultRoot, 'BLACKHOLE');
  fs.mkdirSync(blackholeRoot, {recursive: true, mode: 0o700});
  const realBlackholeRoot = fs.realpathSync(blackholeRoot);
  if (realBlackholeRoot !== path.join(fs.realpathSync(vaultRoot), 'BLACKHOLE')) fail('BLACKHOLE subtree is not a real directory inside the configured vault', 'vault_conflict');
  const target = path.join(realBlackholeRoot, ...segments);
  const dir = path.dirname(target);
  fs.mkdirSync(dir, {recursive: true, mode: 0o700});
  const realDir = fs.realpathSync(dir);
  if (realDir !== realBlackholeRoot && !realDir.startsWith(realBlackholeRoot + path.sep)) fail('Resolved path escaped the BLACKHOLE vault subtree', 'vault_conflict');
  return {absolute: path.join(realDir, path.basename(target)), relative: path.relative(vaultRoot, path.join(realDir, path.basename(target)))};
}

function readExistingFingerprint(absolutePath) {
  let content;
  try {content = fs.readFileSync(absolutePath, 'utf8');} catch {return {exists: false};}
  const generated = GENERATED_LINE.test(content);
  const match = content.match(FINGERPRINT_LINE);
  return {exists: true, generated, fingerprint: match?.[1] ?? null};
}

const yamlValue = value => value === null ? 'null' : /^[A-Za-z0-9._:-]*$/.test(String(value)) ? String(value) : JSON.stringify(String(value));

// Deterministic frontmatter + body. `body` is caller-supplied plain text
// already stripped of anything secret-shaped by the memory-event layer's own
// assertNoSecrets validation (every field here traces back to an
// already-validated canonical Memory Event or Core identity, never raw
// environment/config values).
export function renderMarkdown({frontmatter, title, body}) {
  const front = Object.entries(frontmatter).map(([key, value]) => `${key}: ${yamlValue(value)}`).join('\n');
  return `---\n${front}\n---\n\n# ${title}\n\n${body}\n`;
}

const TYPE_TITLES = Object.freeze({episode: 'Episode', decision: 'Decision', result: 'Result', relationship: 'Relationship', skill: 'Skill', source: 'Source', project: 'Project'});

export function eventRelativeSegments(event) {
  const folder = EVENT_TYPE_FOLDERS[event.type];
  if (!folder) fail(`No export folder mapped for memory event type: ${event.type}`);
  const day = event.createdAt.slice(0, 10);
  return [folder, `${day}-${event.id.slice(0, 8)}.md`];
}

// Pure rendering: no filesystem access, fully testable in isolation from the
// write-safety logic below.
export function renderEventMarkdown(event, {core, project = null, quest = null}) {
  const refs = event.sourceRefs.length
    ? event.sourceRefs.map(ref => `- ${ref.type}: ${ref.id}`).join('\n')
    : '- (없음)';
  const body = [
    event.text,
    '',
    '## Context',
    `- Project: ${project ? `${project.name} (${project.id})` : event.projectId ?? '(none)'}`,
    `- Mission/Quest: ${quest ? `${quest.goal} (${quest.id})` : event.questId ?? '(none)'}`,
    '',
    '## Evidence',
    refs,
    '',
    '## Provenance',
    `- BLACKHOLE Core: ${core.identity.name} (${core.identity.id})`,
    `- Event ID: ${event.id}`,
  ].join('\n');
  return renderMarkdown({
    frontmatter: {blackhole_id: event.id, type: event.type, project_id: event.projectId, quest_id: event.questId, created_at: event.createdAt, confidence: event.confidence, fingerprint: event.fingerprint, generated: true},
    title: TYPE_TITLES[event.type] ?? event.type,
    body,
  });
}

// The write-safety primitive for an immutable per-event export: a given
// event's content never legitimately changes once created, so idempotent
// no-op on an exact fingerprint match, atomic write on a genuinely new path,
// and ANY mismatch (foreign file, hand-edited generated file, or a stale
// fingerprint) is treated as a real conflict - never an overwrite, the new
// content is preserved side-by-side instead.
function writeGenerated(vaultRoot, segments, content, fingerprint, at) {
  const {absolute, relative} = resolveInVault(vaultRoot, segments);
  const existing = readExistingFingerprint(absolute);
  if (!existing.exists) {
    atomicWrite(absolute, content);
    return {result: 'synced', relativePath: relative};
  }
  if (existing.generated && existing.fingerprint === fingerprint) return {result: 'synced', relativePath: relative};
  const pendingSegments = [...segments.slice(0, -1), `${path.basename(segments.at(-1), '.md')}.pending-${at.replace(/[:.]/g, '-')}.md`];
  const {absolute: pendingAbsolute, relative: pendingRelative} = resolveInVault(vaultRoot, pendingSegments);
  atomicWrite(pendingAbsolute, content);
  return {result: 'blocked', errorCode: existing.generated ? 'fingerprint_mismatch' : 'vault_conflict', relativePath: relative, pendingRelativePath: pendingRelative};
}

// The write-safety primitive for a recurring machine-owned dashboard/index
// file (Identity, Current State, Memory Index, Sync Status): unlike a
// per-event export, this content is EXPECTED to legitimately change every
// time the underlying state changes, so a fingerprint mismatch alone can
// never mean tampering here. Conflict Policy A says the exporter fully owns
// these paths, so the only real conflict is a foreign, non-generated file
// already sitting there (e.g. something the owner created by hand at this
// exact path) - once a file already carries `generated: true`, the exporter
// stays free to refresh it. This is what keeps a genuine data change (e.g. a
// new memory event changing the index counts) a clean overwrite instead of
// a spurious blocked "conflict" on every regeneration.
function writeManaged(vaultRoot, segments, content, at) {
  const {absolute, relative} = resolveInVault(vaultRoot, segments);
  const existing = readExistingFingerprint(absolute);
  if (existing.exists && !existing.generated) {
    const pendingSegments = [...segments.slice(0, -1), `${path.basename(segments.at(-1), '.md')}.pending-${at.replace(/[:.]/g, '-')}.md`];
    const {absolute: pendingAbsolute, relative: pendingRelative} = resolveInVault(vaultRoot, pendingSegments);
    atomicWrite(pendingAbsolute, content);
    return {result: 'blocked', errorCode: 'vault_conflict', relativePath: relative, pendingRelativePath: pendingRelative};
  }
  atomicWrite(absolute, content);
  return {result: 'synced', relativePath: relative};
}

// exportEvent(config, event, context, at) — the one entry point server.mjs's
// sync tick calls per pending Obsidian outbox item.
export function exportEvent(config, event, context, at) {
  if (!config.enabled) return {result: 'failed', errorCode: 'not_configured'};
  const segments = eventRelativeSegments(event);
  const content = renderEventMarkdown(event, context);
  try {return writeGenerated(config.vaultRoot, segments, content, event.fingerprint, at);}
  catch (error) {if (error instanceof ObsidianExportError) return {result: 'blocked', errorCode: error.code === 'vault_conflict' ? 'vault_conflict' : 'vault_unavailable'}; throw error;}
}

// Core/index files are regenerated from the current safe Core/memory summary
// only when the caller's own stable digest says something actually changed,
// and freely overwritten here (see writeManaged above) rather than gated on
// a fingerprint match - their content is meant to track current state, not
// stay fixed like an event's.
export function exportGenerated(config, segments, content, at) {
  if (!config.enabled) return {result: 'failed', errorCode: 'not_configured'};
  try {return writeManaged(config.vaultRoot, segments, content, at);}
  catch (error) {if (error instanceof ObsidianExportError) return {result: 'blocked', errorCode: 'vault_conflict'}; throw error;}
}

// Every generated file - index/identity/state files included, not just
// per-event exports - carries its own `fingerprint:` frontmatter line. This
// is what writeGenerated() reads back on the next regeneration to tell "my
// own unchanged prior write" apart from a foreign or hand-edited file; a
// generated file with no fingerprint line at all would always read back as
// null and therefore always look tampered, defeating idempotent no-op
// regeneration. The caller (server.mjs) computes this from stable,
// timestamp-free data and passes the exact same value used for the write
// check, so a real no-op regeneration matches on the very first read-back.
export function renderIdentityMarkdown(core, fingerprint) {
  return renderMarkdown({
    frontmatter: {blackhole_id: core.identity.id, created_at: core.identity.createdAt, fingerprint, generated: true},
    title: 'Identity',
    body: `**Name:** ${core.identity.name}\n**Core ID:** ${core.identity.id}\n**Created:** ${core.identity.createdAt}`,
  });
}

export function renderCurrentStateMarkdown(core, at, fingerprint) {
  return renderMarkdown({
    frontmatter: {blackhole_id: core.identity.id, updated_at: at, fingerprint, generated: true},
    title: 'Current State',
    body: [
      `**Activity:** ${core.activity}`,
      `**Mission:** ${core.mission?.goal ?? '(none)'}`,
      `**Dominant drive:** ${core.dominantDriveName ?? '아직 평가 전'}`,
      `**Active shadows:** ${core.activeShadowCount}`,
    ].join('\n\n'),
  });
}

// Exported separately from the renderer so callers can derive a fingerprint
// from these stable counts alone, without hashing the rendered text (which
// embeds a live timestamp and would never produce a stable fingerprint).
export function memoryIndexCounts(events) {
  return Object.fromEntries(Object.keys(EVENT_TYPE_FOLDERS).map(type => [type, events.filter(e => e.type === type).length]));
}

export function renderMemoryIndexMarkdown(events, at, fingerprint) {
  const byType = memoryIndexCounts(events);
  const lines = Object.entries(byType).filter(([, count]) => count > 0).map(([type, count]) => `- ${TYPE_TITLES[type]}: ${count}`);
  return renderMarkdown({frontmatter: {updated_at: at, fingerprint, generated: true}, title: 'Memory Index', body: lines.length ? lines.join('\n') : '(exported memories will appear here)'});
}

export function renderSyncStatusMarkdown(supabaseSummary, obsidianSummary, at, fingerprint) {
  return renderMarkdown({
    frontmatter: {updated_at: at, fingerprint, generated: true},
    title: 'Sync Status',
    body: [
      `**Supabase:** ${supabaseSummary.counts.synced} synced, ${supabaseSummary.counts.pending} pending, ${supabaseSummary.counts.failed} failed, ${supabaseSummary.counts.blocked} blocked`,
      `**Obsidian:** ${obsidianSummary.counts.synced} synced, ${obsidianSummary.counts.pending} pending, ${obsidianSummary.counts.failed} failed, ${obsidianSummary.counts.blocked} blocked`,
    ].join('\n\n'),
  });
}
