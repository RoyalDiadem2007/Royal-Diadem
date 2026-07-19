-- Mentor 1:1 session requests + friend invites (SXU home "Your people"
-- cards, Maria's approved shape 2026-07-19: student proposes preferred
-- windows, staff confirm the real time; invites go to the admin for
-- personal outreach behind an approval queue — nothing outward leaves the
-- app without a human).
--
-- Both tables are regulated data (CLAUDE.md §17.1 — mentor assignments and
-- a third party's contact address tied to a student). Server-side only: no
-- anon or authenticated grants; every read/write crosses an Edge Function
-- (session, RBAC, rate limit, audit).

create table public.mentor_session_requests (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  -- 1–3 windows the student proposed: [{"date":"YYYY-MM-DD","slot":"..."}],
  -- slot ∈ morning|afternoon|after_school|evening. Shape enforced by the
  -- Edge Function's schema; jsonb here because the windows are a single
  -- short proposal read back verbatim, never queried by part.
  preferred_windows jsonb not null,
  status text not null default 'pending'
    check (status in ('pending', 'confirmed', 'declined')),
  scheduled_date date,
  scheduled_time time,
  end_time time,
  confirmed_by uuid references public.admin_users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- A confirmed session always carries the real time and who set it.
  check (
    status <> 'confirmed'
    or (scheduled_date is not null and scheduled_time is not null and confirmed_by is not null)
  )
);

comment on table public.mentor_session_requests is
  'Student-initiated 1:1 time with a mentor. No mentor assignment model yet (OD-6): requests land in the staff queue and whoever confirms becomes the session''s confirmer. Regulated data — Edge Functions only.';

-- One open ask at a time: the gentle-focus rule, enforced where races can't
-- slip past the Edge Function's count check.
create unique index mentor_session_requests_open_idx
  on public.mentor_session_requests (student_id)
  where status = 'pending';

create index mentor_session_requests_student_idx
  on public.mentor_session_requests (student_id, created_at);
create index mentor_session_requests_status_idx
  on public.mentor_session_requests (status, scheduled_date);

create trigger mentor_session_requests_updated_at
  before update on public.mentor_session_requests
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.mentor_session_requests to service_role;
alter table public.mentor_session_requests enable row level security;

create table public.friend_invites (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  -- The address exists only while the queue holds it: data minimization —
  -- once staff have reached out (or declined), the address is scrubbed and
  -- only the hash remains for dedupe.
  invite_email text,
  -- sha256 hex of the lowercased, trimmed address; survives scrubbing so
  -- the same student can never re-target the same inbox.
  email_hash text not null check (email_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'pending'
    check (status in ('pending', 'reached_out', 'declined')),
  decided_by uuid references public.admin_users (id),
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  -- Pending rows hold the address; decided rows never do.
  check ((status = 'pending') = (invite_email is not null))
);

comment on table public.friend_invites is
  'A student''s nomination of a friend for the program. The address is a third party''s PII: held only while pending, scrubbed on decision. Outreach is a human act — the app never emails the invitee.';

-- Same student + same inbox: once is enough, whatever came of it.
create unique index friend_invites_dedupe_idx
  on public.friend_invites (student_id, email_hash)
  where status in ('pending', 'reached_out');

create index friend_invites_student_idx on public.friend_invites (student_id, created_at);
create index friend_invites_status_idx on public.friend_invites (status);

grant select, insert, update, delete on public.friend_invites to service_role;
alter table public.friend_invites enable row level security;
