-- App settings (Phase 10, Spec §6.8): admin-configurable switches, starting
-- with the Share moderation mode ("Admin can pre-approve or post-approve
-- (configurable)"). Server-side only — settings are read and written through
-- Edge Functions; nothing here is client-visible.
--
-- share_moderation_mode: 'pre' (posts wait for approval before anyone sees
-- them) or 'post' (posts appear immediately, admin reviews after). Default
-- 'pre' — the fail-safe posture for a minors' space; a missing row also
-- reads as 'pre' in the Edge Function layer.

create table public.app_settings (
  key text primary key,
  value text not null,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.admin_users (id)
);

comment on table public.app_settings is
  'Admin-configurable application switches (e.g. share_moderation_mode). Server-side only; every change goes through an audited Edge Function.';

grant select, insert, update on public.app_settings to service_role;
alter table public.app_settings enable row level security;

insert into public.app_settings (key, value) values ('share_moderation_mode', 'pre');
