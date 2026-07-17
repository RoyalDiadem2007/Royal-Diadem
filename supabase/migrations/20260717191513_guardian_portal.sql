-- Guardian access portal (OD-19 build B): guardians become a third kind of
-- signed-in subject, and their access to a student's account is gated by a
-- per-session consent code the STUDENT sees and chooses to share — the
-- notification IS the knowledge. super_admin emergency grants bypass the
-- ceremony (crisis path) and are invisible to the student by design; the
-- audit log carries the whole story either way.

-- ---------------------------------------------------------------------------
-- guardian_accounts — one login per parent, even with multiple daughters
-- enrolled. Separate from `guardians` (which is one row per guardian↔student
-- relationship and holds the COPPA consent record).
-- ---------------------------------------------------------------------------
create table public.guardian_accounts (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  display_name text not null,
  -- Null until the guardian claims their portal magic link (PIN issued at
  -- claim, like students).
  pin_hash text,
  created_at timestamptz not null default now()
);

comment on table public.guardian_accounts is
  'Guardian portal identities (OD-19). email is stored lowercase; pin_hash null = invited but not yet claimed.';

grant select, insert, update, delete on public.guardian_accounts to service_role;
alter table public.guardian_accounts enable row level security;

alter table public.guardians
  add column account_id uuid references public.guardian_accounts (id);

create index guardians_account_idx on public.guardians (account_id);

-- ---------------------------------------------------------------------------
-- guardian_access_requests — the consent-code ceremony + emergency grants.
-- consent_code is a short-lived (10 min), single-use consent SIGNAL shown to
-- the signed-in student so she can choose to share it; it is not an account
-- credential (the guardian must also hold a valid portal session), attempts
-- are rate limited, and rows expire — stored plaintext deliberately so the
-- student's app can display it, with that trade-off documented here.
-- ---------------------------------------------------------------------------
create table public.guardian_access_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.guardian_accounts (id),
  guardian_id uuid not null references public.guardians (id),
  student_id uuid not null references public.students (id),
  consent_code text,
  status text not null default 'pending'
    check (status in ('pending', 'approved', 'denied', 'expired')),
  -- True for the super_admin crisis path: no code, no student-visible trace.
  emergency boolean not null default false,
  granted_by uuid references public.admin_users (id),
  code_expires_at timestamptz,
  granted_at timestamptz,
  access_expires_at timestamptz,
  created_at timestamptz not null default now(),
  constraint emergency_carries_granter check (not emergency or granted_by is not null),
  constraint pending_carries_code
    check (status <> 'pending' or emergency or consent_code is not null)
);

comment on table public.guardian_access_requests is
  'Guardian→student access grants (OD-19): consent-code ceremony rows plus audited super_admin emergency grants. Access is valid while status=approved and now() < access_expires_at.';

create index guardian_access_requests_student_idx
  on public.guardian_access_requests (student_id, status, created_at);
create index guardian_access_requests_account_idx
  on public.guardian_access_requests (account_id, status, created_at);

grant select, insert, update, delete on public.guardian_access_requests to service_role;
alter table public.guardian_access_requests enable row level security;

-- ---------------------------------------------------------------------------
-- Widen the fixed-role checks now that guardians can act and sign in.
-- ---------------------------------------------------------------------------
alter table public.sessions
  drop constraint sessions_subject_type_check,
  add constraint sessions_subject_type_check
    check (subject_type in ('student', 'admin', 'guardian'));

alter table public.audit_logs
  drop constraint audit_logs_actor_type_check,
  add constraint audit_logs_actor_type_check
    check (actor_type in ('student', 'admin', 'guardian', 'system'));

alter table public.audit_logs
  drop constraint audit_logs_actor_role_check,
  add constraint audit_logs_actor_role_check
    check (actor_role in ('student', 'super_admin', 'mentor', 'viewer', 'guardian', 'system'));

alter table public.magic_links
  drop constraint magic_links_purpose_check,
  add constraint magic_links_purpose_check
    check (purpose in ('first_login', 'guardian_portal'));
