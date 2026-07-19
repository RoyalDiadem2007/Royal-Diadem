-- Student profiles + goals + strengths (SXU, Maria's approved model
-- 2026-07-19 — resolves OD-8's "student goals" missing table). The Queen
-- Card's data: private to the student and authorized staff, NEVER public,
-- never shared socially by default. Free text (what she's proud of, her
-- goal titles and next steps) is regulated data (CLAUDE.md §17.1) and gets
-- the journal's application-layer encryption: ciphertext + iv pairs,
-- nothing readable at rest. Server-side only — no anon or authenticated
-- grants anywhere here; every read/write crosses the student-profile Edge
-- Function (session, RBAC, audit).

create table public.student_profiles (
  student_id uuid primary key references public.students (id),
  -- An illustrated avatar identifier (no photograph required — SXU brief).
  avatar_key text,
  proud_of_ciphertext text,
  proud_of_iv text,
  updated_at timestamptz not null default now()
);

create trigger student_profiles_updated_at
  before update on public.student_profiles
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.student_profiles to service_role;
alter table public.student_profiles enable row level security;

create table public.student_goals (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  title_ciphertext text not null,
  title_iv text not null,
  next_step_ciphertext text,
  next_step_iv text,
  status text not null default 'not_started'
    check (status in ('not_started', 'growing', 'completed')),
  target_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

comment on table public.student_goals is
  'SXU goals ("What I''m growing toward"): no rankings, no streaks, no leaderboards — status language is Not started / Growing / Completed by design.';

create trigger student_goals_updated_at
  before update on public.student_goals
  for each row execute function public.set_updated_at();

create index student_goals_student_idx on public.student_goals (student_id, status);

grant select, insert, update, delete on public.student_goals to service_role;
alter table public.student_goals enable row level security;

-- The administrator-approved strengths vocabulary (SXU brief): students
-- pick from this list only; admins curate it (management UI ships with the
-- Queen Card phase — the table starts empty, like the relaxation library).
create table public.strength_options (
  key text primary key check (key ~ '^[a-z0-9-]{1,40}$'),
  label text not null,
  active boolean not null default true,
  created_by uuid not null references public.admin_users (id),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.strength_options to service_role;
alter table public.strength_options enable row level security;

create table public.student_strengths (
  student_id uuid not null references public.students (id),
  strength_key text not null references public.strength_options (key),
  created_at timestamptz not null default now(),
  primary key (student_id, strength_key)
);

grant select, insert, delete on public.student_strengths to service_role;
alter table public.student_strengths enable row level security;
