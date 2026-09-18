-- BLACKHOLE Durable Memory Fabric — Phase B schema (issue #25).
--
-- DESIGN-ONLY IN REPO. Do not apply this migration to any live Supabase
-- project (including the currently connected `For-Ai` or `buzz-hq` projects)
-- until the owner explicitly selects a destination project. This file is
-- reviewed here so the schema exists in version control before any live
-- acceptance step.
--
-- Layering: Supabase is an external durable/searchable MIRROR of the
-- canonical local Memory Event (runtime/lib/memory-events.mjs). It is never
-- a competing source of truth - `memory_events.id` is the same canonical
-- event id the local store already assigned, never a server-generated
-- replacement, and `fingerprint` is the same tamper-evident hash the local
-- record carries. A row here can be deleted and safely re-mirrored from the
-- local store at any time without losing any meaning.
--
-- Security posture (Phase B §4): RLS is enabled on every table with NO
-- policies defined, so anon/authenticated roles get zero rows by default
-- (Postgres denies all access to a table with RLS enabled and no matching
-- policy). BLACKHOLE's runtime talks to this schema using the Supabase
-- service-role credential over PostgREST; the service role BYPASSES RLS by
-- design, so authority over which rows any given request may touch remains
-- entirely in BLACKHOLE's own server code (runtime/lib/memory-supabase-adapter.mjs),
-- never delegated to a client-side anon/authenticated key. If a future phase
-- introduces authenticated end-user querying, add real per-owner RLS
-- policies keyed on auth.uid()/JWT claims at that time - do not add a
-- permissive "true" policy as a shortcut.
--
-- Deliberately NOT included in this pass (see Phase B kickoff comment):
--   * blackhole.memory_embeddings - no live embedding provider is selected
--     yet; forcing an embeddings table now would be schema speculation.
--   * blackhole.sync_receipts - the local durable outbox
--     (runtime/lib/memory-sync-outbox.mjs) already provides at-least-once
--     delivery bookkeeping and auditability; a second sync ledger here would
--     duplicate it without need.

create schema if not exists blackhole;

comment on schema blackhole is
  'BLACKHOLE Durable Memory Fabric (Phase B). External mirror of the canonical local Memory Event; never source of truth. RLS enabled with no anon/authenticated policies - accessed only via the service-role credential from BLACKHOLE server code.';

-- ---------------------------------------------------------------------------
-- blackhole.core_instances
-- ---------------------------------------------------------------------------
-- Stable BLACKHOLE identity (blackhole-core.mjs's Persistent Self identity),
-- not a device or owner account identity. One row per distinct BLACKHOLE
-- installation that has ever synced to this project.

create table if not exists blackhole.core_instances (
  core_id         uuid primary key,
  name            text not null check (char_length(name) between 1 and 80),
  created_at      timestamptz not null,
  schema_version  integer not null check (schema_version >= 1),
  first_seen_at   timestamptz not null,
  last_seen_at    timestamptz not null,
  metadata        jsonb not null default '{}'::jsonb,
  constraint core_instances_last_seen_after_first check (last_seen_at >= first_seen_at)
);

comment on table blackhole.core_instances is
  'One row per stable BLACKHOLE Persistent Self identity. metadata is bounded, non-secret, forward-compatible detail only - never credentials or raw environment values.';

alter table blackhole.core_instances enable row level security;

-- ---------------------------------------------------------------------------
-- blackhole.memory_events
-- ---------------------------------------------------------------------------
-- Mirrors the canonical local Memory Event's identity and searchable
-- metadata exactly (runtime/lib/memory-events.mjs's MEMORY_EVENT_FIELDS /
-- MEMORY_EVENT_TYPES). id is the canonical event's own UUID, never a
-- server-generated surrogate - a duplicate insert of the same id is an
-- upsert onto the same row, never a second memory.

create table if not exists blackhole.memory_events (
  id              uuid primary key,
  core_id         uuid not null references blackhole.core_instances (core_id) on delete cascade,
  version         integer not null check (version >= 1),
  type            text not null check (type in ('episode', 'decision', 'result', 'relationship', 'skill', 'source', 'project')),
  text            text not null check (char_length(text) between 1 and 4000),
  confidence      numeric not null check (confidence >= 0 and confidence <= 1),
  project_id      uuid null,
  quest_id        uuid null,
  created_at      timestamptz not null,
  fingerprint     text not null unique check (fingerprint ~ '^[a-f0-9]{64}$'),
  source_refs     jsonb not null default '[]'::jsonb,
  synced_at       timestamptz not null default now(),
  -- Only if a future correction/amendment flow is introduced cleanly at the
  -- canonical layer first; left nullable and unused until then.
  supersedes_id   uuid null references blackhole.memory_events (id),
  metadata        jsonb not null default '{}'::jsonb
);

comment on table blackhole.memory_events is
  'External mirror of the canonical local Memory Event. Never source of truth: BLACKHOLE runtime state.json / the local memoryEvents ledger remains authoritative for event meaning. id is the canonical event id (never server-generated); fingerprint is unique so a re-synced identical event can never create a second row.';

create index if not exists memory_events_core_id_idx on blackhole.memory_events (core_id);
create index if not exists memory_events_project_id_idx on blackhole.memory_events (project_id) where project_id is not null;
create index if not exists memory_events_quest_id_idx on blackhole.memory_events (quest_id) where quest_id is not null;
create index if not exists memory_events_type_idx on blackhole.memory_events (type);
create index if not exists memory_events_created_at_idx on blackhole.memory_events (created_at desc);

alter table blackhole.memory_events enable row level security;

-- No anon or authenticated policies are created in this pass. With RLS
-- enabled and zero policies, every role except the table owner and the
-- service role (which bypasses RLS entirely) sees zero rows and can write
-- zero rows. This is intentionally the most restrictive starting point;
-- loosen it deliberately and narrowly if a later phase needs it.
