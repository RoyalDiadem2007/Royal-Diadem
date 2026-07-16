-- Custom auth sessions (OD-1 decided 2026-07-16).
--
-- This project uses PIN + WebAuthn with server-minted opaque tokens — NOT
-- Supabase Auth (docs/SUPABASE_RULES.md §3). Edge Functions mint a 256-bit
-- random token, store only its SHA-256 hash here, and validate every request
-- against this table. Tokens are revocable and expire; the client holds the
-- raw token in memory only (never localStorage — CLAUDE.md §3).

create table public.sessions (
  id uuid primary key default gen_random_uuid(),
  -- SHA-256 hex of the opaque session token. The raw token is never stored.
  token_hash text not null unique,
  subject_type text not null check (subject_type in ('student', 'admin')),
  -- References students.id or admin_users.id depending on subject_type;
  -- polymorphic, so enforced by the Edge Function layer, not an FK.
  subject_id uuid not null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  ip_address inet,
  user_agent text
);

comment on table public.sessions is
  'Opaque-token sessions for custom PIN/WebAuthn auth. Validated server-side by Edge Functions; auth.uid() is unavailable in this project.';

create index sessions_subject_idx on public.sessions (subject_type, subject_id);
create index sessions_expires_at_idx on public.sessions (expires_at);

-- Server-side only. delete is granted for expiry purging of long-dead rows;
-- session lifecycle events (login/logout/revoke) are recorded in audit_logs.
grant select, insert, update, delete on public.sessions to service_role;

alter table public.sessions enable row level security;
-- No policies: invisible to anon/authenticated; server key only.
