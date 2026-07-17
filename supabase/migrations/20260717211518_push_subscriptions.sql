-- Web push subscriptions (VAPID). One row per browser/device push endpoint,
-- owned by whichever signed-in subject enabled notifications. Endpoints and
-- keys are opaque push-service material — no student content ever rides a
-- push payload (payloads are generic "open the app" nudges).

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('student', 'admin', 'guardian')),
  subject_id uuid not null,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  created_at timestamptz not null default now()
);

create index push_subscriptions_subject_idx
  on public.push_subscriptions (subject_type, subject_id);

grant select, insert, update, delete on public.push_subscriptions to service_role;
alter table public.push_subscriptions enable row level security;
