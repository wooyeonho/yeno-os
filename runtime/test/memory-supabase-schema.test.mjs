import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

// BLACKHOLE Durable Memory Fabric (Phase B) — the SQL migration/spec is
// design-only in this repo (never applied to a live project by this branch,
// see the Phase B kickoff §15). CI has no live Postgres to apply it against,
// so these are static structural assertions against the SQL text itself:
// the schema exists, RLS is enabled with no permissive policy, the
// canonical id/fingerprint relationship is enforced, and the migration
// never accidentally introduces a live-apply step.

const here = path.dirname(fileURLToPath(import.meta.url));
const sqlPath = path.join(here, '..', 'supabase', 'migrations', '0001_blackhole_memory_fabric.sql');
const sql = fs.readFileSync(sqlPath, 'utf8');
const normalized = sql.toLowerCase();
// SQL `--` line comments wrap prose across lines; flatten those continuations
// into plain sentences so phrase-level assertions don't have to account for
// exactly where a comment happened to wrap.
const prose = sql.split('\n').map(line => line.replace(/^\s*--\s?/, '')).join(' ').replace(/\s+/g, ' ');

test('the migration file exists and documents itself as design-only, not for live application', () => {
  assert.ok(sql.length > 0);
  assert.match(prose, /design-only/i);
  assert.match(prose, /do not apply this migration to any live supabase project/i);
});

test('the migration explicitly names For-Ai and buzz-hq as projects it must never touch', () => {
  assert.match(prose, /for-ai/i);
  assert.match(prose, /buzz-hq/i);
});

test('creates a dedicated blackhole schema rather than polluting the public schema', () => {
  assert.match(normalized, /create schema if not exists blackhole;/);
});

test('core_instances and memory_events tables exist with the expected primary keys', () => {
  assert.match(normalized, /create table if not exists blackhole\.core_instances\s*\(/);
  assert.match(normalized, /core_id\s+uuid primary key/);
  assert.match(normalized, /create table if not exists blackhole\.memory_events\s*\(/);
  assert.match(normalized, /id\s+uuid primary key/);
});

test('memory_events.id is documented as the canonical local event id, never server-generated', () => {
  assert.match(prose, /never a server-generated/i);
  assert.match(prose, /canonical event id/i);
});

test('memory_events.fingerprint is unique, so a re-synced identical event can never create a second row', () => {
  assert.match(normalized, /fingerprint\s+text not null unique/);
});

test('memory_events.core_id is a real foreign key into core_instances, never a free-floating value', () => {
  assert.match(normalized, /core_id\s+uuid not null references blackhole\.core_instances\s*\(core_id\)/);
});

test('memory_events.type is constrained to exactly the canonical MEMORY_EVENT_TYPES taxonomy', () => {
  assert.match(normalized, /type in \('episode', 'decision', 'result', 'relationship', 'skill', 'source', 'project'\)/);
});

test('row level security is enabled on every exposed table', () => {
  assert.match(normalized, /alter table blackhole\.core_instances enable row level security;/);
  assert.match(normalized, /alter table blackhole\.memory_events enable row level security;/);
});

test('no permissive anon/authenticated policy is ever created - RLS enabled with zero policies denies by default', () => {
  assert.equal(/create policy/i.test(sql), false, 'a policy would need explicit review; this pass intentionally defines none');
  assert.equal(/to anon/i.test(sql), false);
  assert.equal(/using \(true\)/i.test(sql), false, 'a permissive true-returning policy must never exist here');
});

test('documents that only the service-role credential (never anon/authenticated) is expected to access this schema', () => {
  assert.match(prose, /service.role/i);
  assert.match(prose, /bypass(es)? rls/i);
});

test('explicitly documents skipping memory_embeddings and sync_receipts rather than silently omitting them', () => {
  assert.match(prose, /memory_embeddings/i);
  assert.match(prose, /no live embedding provider/i);
  assert.match(prose, /sync_receipts/i);
});

test('never contains a live project connection string, API key, or JWT secret', () => {
  assert.equal(/postgres:\/\/[^\s]*:[^\s]*@/.test(sql), false);
  assert.equal(/service_role.{0,20}eyj/i.test(sql), false);
  assert.equal(/sk-[a-z0-9]{10,}/i.test(sql), false);
});
