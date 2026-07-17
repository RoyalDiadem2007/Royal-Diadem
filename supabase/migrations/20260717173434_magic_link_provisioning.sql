-- Magic-link onboarding (Phase 4c, OD-19): low-friction credential delivery.
--
-- students.email exists for 13+ only — an under-13's own email is never
-- collected before guardian consent (COPPA); her provisioning goes through
-- the guardian's email on the guardians table.
--
-- magic_links holds single-use first-login tokens: SHA-256 digest only (the
-- raw token exists solely inside the email link), 72h expiry, revocable, and
-- kept after use as part of the provisioning audit trail (no DELETE grant).

alter table public.students
  add column email text;

comment on column public.students.email is
  'Student contact email — collected for ages 13+ only (OD-19); under-13 provisioning uses the guardian''s email. Regulated data like the rest of the row.';

create table public.magic_links (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  -- Whose inbox the link went to. Guardian links (11-12 setup, and later the
  -- guardian access portal) carry the guardian row they were issued to.
  recipient text not null check (recipient in ('student', 'guardian')),
  guardian_id uuid references public.guardians (id),
  token_hash text not null unique,
  purpose text not null default 'first_login' check (purpose in ('first_login')),
  expires_at timestamptz not null,
  used_at timestamptz,
  revoked_at timestamptz,
  created_by uuid not null references public.admin_users (id),
  created_at timestamptz not null default now(),
  constraint guardian_links_carry_guardian
    check (recipient <> 'guardian' or guardian_id is not null)
);

comment on table public.magic_links is
  'Single-use first-login tokens (OD-19). Hash only — raw token lives only in the emailed link. Rows persist after use/revocation as the provisioning audit trail.';

create index magic_links_student_idx on public.magic_links (student_id, created_at);

-- The provisioning *audit* trail lives in audit_logs (issue + claim events);
-- magic_links rows are operational. delete stays server-only and no Edge
-- Function calls it — it exists for controlled cleanup and the future OD-5
-- data-deletion workflow.
grant select, insert, update, delete on public.magic_links to service_role;
alter table public.magic_links enable row level security;

-- guardians: consent *immutability* is a workflow rule (§2 human-approved
-- deletes only; no Edge Function deletes). The server-role grant exists for
-- the OD-5 COPPA deletion-rights workflow and controlled cleanup.
grant delete on public.guardians to service_role;
