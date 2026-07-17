-- Crown Check daily model (Phase 5, Spec §6.2): one check per student per
-- program-local day, editable until midnight — her latest feeling counts.
--
-- check_date is the calendar day in the program's timezone, NOT the UTC day of
-- created_at: a check-in at 8pm in Houston belongs to that evening's day, and
-- "consecutive low days" (the AI flag rule) must count days the way the girls
-- live them. The Edge Function always sets it explicitly from the
-- PROGRAM_TIMEZONE secret; the column default mirrors the same deployment
-- default ('America/Chicago') so direct inserts (tests, tooling) stay
-- consistent with it.

alter table public.crown_checks
  add column check_date date not null
    default ((now() at time zone 'America/Chicago')::date),
  add column updated_at timestamptz not null default now();

comment on column public.crown_checks.check_date is
  'Program-local calendar day of the check-in (PROGRAM_TIMEZONE). One row per student per day; same-day resubmits update in place.';

create trigger crown_checks_updated_at
  before update on public.crown_checks
  for each row execute function public.set_updated_at();

-- One check per student per day; same-day submits become updates (upsert
-- target). Also serves the trend queries (student_id, check_date desc).
create unique index crown_checks_student_day_key
  on public.crown_checks (student_id, check_date);
