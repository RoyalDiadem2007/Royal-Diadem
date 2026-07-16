-- Append-only audit log (CLAUDE.md §17.2 audit controls; OD-4 decided 2026-07-16).
--
-- Records every create/read/update/delete of regulated data plus auth events:
-- who (actor id + role), what (entity type + id + action), when (UTC), from
-- where (IP), and outcome (allowed/denied). Denied attempts are logged too.
--
-- Immutability: no UPDATE/DELETE/TRUNCATE grant for ANY role. Rows log ids,
-- never contents (CLAUDE.md §6). Retention: >= 6 years (HIPAA standard) —
-- never auto-purge; any purge is a human decision outside this schema.

create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  actor_type text not null check (actor_type in ('student', 'admin', 'system')),
  actor_id uuid,
  actor_role text check (actor_role in ('student', 'super_admin', 'mentor', 'viewer', 'system')),
  action text not null check (
    action in ('create', 'read', 'update', 'delete', 'login', 'logout', 'consent', 'export')
  ),
  entity_type text not null,
  entity_id uuid,
  outcome text not null check (outcome in ('allowed', 'denied')),
  ip_address inet,
  -- Structured context: ids, counts, codes only — NEVER contents or PII.
  metadata jsonb,
  created_at timestamptz not null default now()
);

comment on table public.audit_logs is
  'Append-only audit trail (HIPAA 164.312(b)). No UPDATE/DELETE grants for any role. Retain >= 6 years; never auto-purge. Log ids, never contents.';

create index audit_logs_entity_idx on public.audit_logs (entity_type, entity_id);
create index audit_logs_actor_idx on public.audit_logs (actor_type, actor_id);
create index audit_logs_created_at_idx on public.audit_logs (created_at);

-- Data API exposure (docs/SUPABASE_RULES.md §2): server-side writes/reads only.
-- Deliberately NO update/delete/truncate for anyone — append-only by grant.
grant insert, select on public.audit_logs to service_role;
-- anon and authenticated get nothing.

alter table public.audit_logs enable row level security;
-- No policies: with RLS on and no policies, nothing is visible except to the
-- server-side secret key (service_role bypasses RLS). Defense-in-depth.
