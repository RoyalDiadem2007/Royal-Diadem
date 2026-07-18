-- relaxation_content (Phase 11, Spec §6.3 + OD-8's missing table): the
-- admin-curated calming library — affirmations, scripture, grounding
-- prompts. Genuinely public program content (same class as announcements):
-- anon may read ACTIVE rows directly, and the service worker is allowed to
-- cache exactly this response for offline comfort (CLAUDE.md §3 names
-- relaxation content as permitted offline cache material). Curation goes
-- through the admin-relaxation Edge Function (audited authorship).

create table public.relaxation_content (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('affirmation', 'scripture', 'grounding')),
  title text not null,
  body text not null,
  active boolean not null default true,
  sort_order integer not null default 0,
  created_by uuid not null references public.admin_users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger relaxation_content_updated_at
  before update on public.relaxation_content
  for each row execute function public.set_updated_at();

create index relaxation_content_active_idx
  on public.relaxation_content (active, kind, sort_order);

grant select on public.relaxation_content to anon;
grant select, insert, update, delete on public.relaxation_content to service_role;
alter table public.relaxation_content enable row level security;

create policy "anon reads active relaxation content"
  on public.relaxation_content
  for select
  to anon
  using (active = true);
