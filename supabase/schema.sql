-- IDEA hosted-mode store (S-51, docs/architecture/12-hosted-mode.md).
-- Run once in the Supabase SQL editor (Dashboard → SQL Editor → paste → Run).
-- Safe to re-run: everything is IF NOT EXISTS / idempotent.
--
-- One table of small text documents, namespaced by the signed-in GitHub
-- login. Conversations live under "<login>" + ".idea/conversations/…" paths;
-- per-user settings under "<login>" + "settings/…". The `sha` column is a
-- version token for optimistic concurrency — IDEA updates a row only when
-- the sha still matches what it read, and retries on conflict.

create table if not exists public.idea_hosted_files (
  namespace  text        not null,
  path       text        not null,
  content    text        not null,
  sha        text        not null,
  updated_at timestamptz not null default now(),
  primary key (namespace, path)
);

-- RLS on, with NO policies, deliberately (NFR-4, fail closed): the anon /
-- publishable key can neither read nor write anything. Only IDEA's server,
-- holding the secret key (which bypasses RLS), can touch this table.
alter table public.idea_hosted_files enable row level security;

-- Listing a user's conversations filters on namespace + path prefix.
create index if not exists idea_hosted_files_ns_path
  on public.idea_hosted_files (namespace, path text_pattern_ops);
