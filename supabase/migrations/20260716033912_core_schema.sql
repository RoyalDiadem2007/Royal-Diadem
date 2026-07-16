-- Core schema — Spec §8, under the custom-PIN-auth grant model
-- (docs/SUPABASE_RULES.md §3):
--
--   * anon (the browser's publishable key) gets a narrow SELECT only on
--     genuinely public, non-student content: posted encouragement messages,
--     announcements, visible calendar events, About content.
--   * ALL tables holding minors' data are server-side only: no anon or
--     authenticated grants at all. Edge Functions (secret key) mediate every
--     read/write, with RLS enabled everywhere as defense-in-depth.
--   * `authenticated` is unused (no Supabase Auth sessions) and gets nothing.
--
-- Notes vs the spec: students.age is computed from date_of_birth at query
-- time (a stored age goes stale); Spec §8 allows "computed or stored".

-- ---------------------------------------------------------------------------
-- Shared trigger: keep updated_at honest.
-- ---------------------------------------------------------------------------
create function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- admin_users — created before students so verified_by/created_by FKs resolve.
-- ---------------------------------------------------------------------------
create table public.admin_users (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  role text not null check (role in ('super_admin', 'mentor', 'viewer')),
  pin_hash text not null,
  webauthn_credential_id text,
  webauthn_public_key text,
  email text not null unique,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.admin_users to service_role;
alter table public.admin_users enable row level security;

-- ---------------------------------------------------------------------------
-- students — regulated data (CLAUDE.md §17.1). Server-side only.
-- ---------------------------------------------------------------------------
create table public.students (
  id uuid primary key default gen_random_uuid(),
  first_name text not null,
  last_name text not null,
  display_name text not null,
  date_of_birth date not null,
  grade_level text,
  school_name text,
  pin_hash text not null,
  webauthn_credential_id text,
  webauthn_public_key text,
  profile_photo_url text,
  enrollment_date timestamptz not null default now(),
  phase text,
  status text not null default 'active' check (status in ('active', 'inactive', 'graduated')),
  coppa_required boolean not null default false,
  coppa_consent_status text not null default 'pending'
    check (coppa_consent_status in ('pending', 'verified', 'denied')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.students is
  'Regulated data (minors). No client grants; Edge Functions only. COPPA: account is unusable until coppa_consent_status = verified when coppa_required.';

create trigger students_updated_at
  before update on public.students
  for each row execute function public.set_updated_at();

grant select, insert, update, delete on public.students to service_role;
alter table public.students enable row level security;

-- ---------------------------------------------------------------------------
-- guardians — COPPA consent records; admin-only access (Spec §8 RLS).
-- ---------------------------------------------------------------------------
create table public.guardians (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  guardian_name text not null,
  relationship text not null check (relationship in ('parent', 'legal_guardian', 'other')),
  email text,
  phone text,
  consent_given boolean not null default false,
  consent_method text check (consent_method in ('digital_form', 'in_person', 'paper')),
  consent_timestamp timestamptz,
  verified_by uuid references public.admin_users (id),
  verification_timestamp timestamptz
);

comment on table public.guardians is
  'COPPA consent audit trail — permanent record (Spec §3). Never hard-delete without human approval (CLAUDE.md §2).';

create index guardians_student_idx on public.guardians (student_id);

grant select, insert, update on public.guardians to service_role; -- no delete: permanent audit trail
alter table public.guardians enable row level security;

-- ---------------------------------------------------------------------------
-- crown_checks — daily emotional temp check (Spec §6.2). Regulated.
-- ---------------------------------------------------------------------------
create table public.crown_checks (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  mood_score int not null check (mood_score between 1 and 5),
  mood_emoji text not null,
  note text,
  ai_flag_triggered boolean not null default false,
  ai_flag_reason text,
  created_at timestamptz not null default now()
);

create index crown_checks_student_idx on public.crown_checks (student_id, created_at);

grant select, insert, update, delete on public.crown_checks to service_role;
alter table public.crown_checks enable row level security;

-- ---------------------------------------------------------------------------
-- journal_prompts + journal_entries (Spec §6.4). Entries are regulated;
-- entry_text arrives already encrypted by the Edge Function (OD-2: AES-256-GCM,
-- server-held key) — the database never sees plaintext journal content.
-- ---------------------------------------------------------------------------
create table public.journal_prompts (
  id uuid primary key default gen_random_uuid(),
  prompt_text text not null,
  created_by uuid not null references public.admin_users (id),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.journal_prompts to service_role;
alter table public.journal_prompts enable row level security;

create table public.journal_entries (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  prompt_id uuid references public.journal_prompts (id),
  -- AES-256-GCM ciphertext (base64) + IV, encrypted/decrypted only inside
  -- Edge Functions. Plaintext never reaches the database or the client cache.
  entry_ciphertext text not null,
  entry_iv text not null,
  ai_flag_triggered boolean not null default false,
  ai_flag_reason text,
  mentor_id uuid references public.admin_users (id),
  created_at timestamptz not null default now()
);

comment on table public.journal_entries is
  'Journal text is stored encrypted (OD-2). Visible to the student and her assigned mentor only — enforced in the Edge Function layer and auditable via audit_logs.';

create index journal_entries_student_idx on public.journal_entries (student_id, created_at);
create index journal_entries_mentor_idx on public.journal_entries (mentor_id);

grant select, insert, update, delete on public.journal_entries to service_role;
alter table public.journal_entries enable row level security;

-- ---------------------------------------------------------------------------
-- encouragement_messages (Spec §6.5) — AI-drafted, admin-approved. The only
-- content the client may read directly is a posted message.
-- ---------------------------------------------------------------------------
create table public.encouragement_messages (
  id uuid primary key default gen_random_uuid(),
  message_text text not null,
  source text not null check (source in ('ai_generated', 'admin_written')),
  ai_generation_metadata jsonb,
  scheduled_date date not null,
  week_of date not null,
  status text not null default 'draft'
    check (status in ('draft', 'approved', 'posted', 'rejected')),
  posted_at timestamptz,
  posted_by uuid references public.admin_users (id),
  created_at timestamptz not null default now()
);

create index encouragement_messages_schedule_idx
  on public.encouragement_messages (scheduled_date, status);

grant select on public.encouragement_messages to anon;
grant select, insert, update, delete on public.encouragement_messages to service_role;
alter table public.encouragement_messages enable row level security;

create policy "anon reads only posted daily messages"
  on public.encouragement_messages
  for select
  to anon
  using (status = 'posted');

-- ---------------------------------------------------------------------------
-- calendar_events (Spec §6.6) — public program content.
-- ---------------------------------------------------------------------------
create table public.calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  event_date date not null,
  event_time time,
  end_time time,
  is_recurring boolean not null default false,
  recurrence_rule text,
  visibility text not null default 'all' check (visibility in ('all', 'specific_group')),
  created_by uuid not null references public.admin_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger calendar_events_updated_at
  before update on public.calendar_events
  for each row execute function public.set_updated_at();

create index calendar_events_date_idx on public.calendar_events (event_date);

grant select on public.calendar_events to anon;
grant select, insert, update, delete on public.calendar_events to service_role;
alter table public.calendar_events enable row level security;

create policy "anon reads events visible to everyone"
  on public.calendar_events
  for select
  to anon
  using (visibility = 'all');

-- ---------------------------------------------------------------------------
-- announcements + read receipts (Spec §6.7). Announcements are public program
-- content; read receipts reference students, so they stay server-side.
-- ---------------------------------------------------------------------------
create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  priority text not null default 'normal' check (priority in ('normal', 'urgent')),
  posted_by uuid not null references public.admin_users (id),
  created_at timestamptz not null default now()
);

grant select on public.announcements to anon;
grant select, insert, update, delete on public.announcements to service_role;
alter table public.announcements enable row level security;

create policy "anon reads announcements"
  on public.announcements
  for select
  to anon
  using (true);

create table public.announcement_reads (
  id uuid primary key default gen_random_uuid(),
  announcement_id uuid not null references public.announcements (id),
  student_id uuid not null references public.students (id),
  read_at timestamptz not null default now(),
  unique (announcement_id, student_id)
);

grant select, insert, delete on public.announcement_reads to service_role;
alter table public.announcement_reads enable row level security;

-- ---------------------------------------------------------------------------
-- Share feed (Spec §6.8) — student content with moderation + peer flags.
-- Server-side only: posts carry student identity and pre-moderation content.
-- ---------------------------------------------------------------------------
create table public.share_posts (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.students (id),
  post_type text not null check (post_type in ('photo', 'text', 'photo_text')),
  content_text text,
  image_url text,
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'removed')),
  created_at timestamptz not null default now()
);

create index share_posts_moderation_idx on public.share_posts (moderation_status, created_at);
create index share_posts_student_idx on public.share_posts (student_id);

grant select, insert, update, delete on public.share_posts to service_role;
alter table public.share_posts enable row level security;

create table public.share_comments (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.share_posts (id),
  student_id uuid not null references public.students (id),
  comment_text text not null,
  moderation_status text not null default 'pending'
    check (moderation_status in ('pending', 'approved', 'removed')),
  created_at timestamptz not null default now()
);

create index share_comments_post_idx on public.share_comments (post_id);

grant select, insert, update, delete on public.share_comments to service_role;
alter table public.share_comments enable row level security;

create table public.share_reactions (
  id uuid primary key default gen_random_uuid(),
  post_id uuid not null references public.share_posts (id),
  student_id uuid not null references public.students (id),
  emoji text not null,
  created_at timestamptz not null default now(),
  -- One reaction per emoji per student per post.
  unique (post_id, student_id, emoji)
);

grant select, insert, delete on public.share_reactions to service_role;
alter table public.share_reactions enable row level security;

-- ---------------------------------------------------------------------------
-- flags (Spec §7) — AI + peer safety flags. Highly sensitive; server-side only.
-- ---------------------------------------------------------------------------
create table public.flags (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('ai', 'peer')),
  entity_type text not null
    check (entity_type in ('crown_check', 'journal', 'share_post', 'share_comment')),
  entity_id uuid not null,
  -- student_id for peer flags (anonymous to students, visible to admins); null for AI.
  flagged_by uuid references public.students (id),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  status text not null default 'new' check (status in ('new', 'reviewed', 'resolved')),
  admin_notes text,
  reviewed_by uuid references public.admin_users (id),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.flags is
  'Safety flags (OD-3): high severity surfaces immediately to super_admins in the admin panel. Escalation beyond the panel (email/SMS, mandated reporting) is a pending client protocol — see PROJECT_STATE.md.';

create index flags_status_idx on public.flags (status, severity, created_at);
create index flags_entity_idx on public.flags (entity_type, entity_id);

grant select, insert, update on public.flags to service_role; -- no delete: safety history is permanent
alter table public.flags enable row level security;

-- ---------------------------------------------------------------------------
-- about_content (Spec §6.9) — public static content, admin-editable.
-- ---------------------------------------------------------------------------
create table public.about_content (
  id uuid primary key default gen_random_uuid(),
  section text not null unique check (section in ('about_org', 'pastor_bio')),
  title text not null,
  body text not null,
  image_url text,
  updated_by uuid not null references public.admin_users (id),
  updated_at timestamptz not null default now()
);

create trigger about_content_updated_at
  before update on public.about_content
  for each row execute function public.set_updated_at();

grant select on public.about_content to anon;
grant select, insert, update, delete on public.about_content to service_role;
alter table public.about_content enable row level security;

create policy "anon reads about content"
  on public.about_content
  for select
  to anon
  using (true);
