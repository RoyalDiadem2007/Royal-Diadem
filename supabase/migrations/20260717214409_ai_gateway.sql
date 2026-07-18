-- Governed AI gateway support tables (OD-18, Phase 7).
--
-- ai_rules: HUMAN-APPROVED constraints that feed the gateway's locked system
-- prompt and validator. Rules enter only through the admin panel — never from
-- raw feedback, never automatically (OD-18: no auto-learning, no poisoning).
--
-- ai_corrections: the lean corrective loop. Every admin reject/replace of an
-- AI draft records original + correction + reason + reviewer + model/prompt
-- version, so the story of every intervention is durable and queryable.

create table public.ai_rules (
  id uuid primary key default gen_random_uuid(),
  rule_text text not null,
  active boolean not null default true,
  created_by uuid not null references public.admin_users (id),
  created_at timestamptz not null default now()
);

grant select, insert, update, delete on public.ai_rules to service_role;
alter table public.ai_rules enable row level security;

create table public.ai_corrections (
  id uuid primary key default gen_random_uuid(),
  message_id uuid not null references public.encouragement_messages (id),
  original_text text not null,
  -- Null when the draft was rejected without a replacement.
  corrected_text text,
  reason text not null,
  rule_violated uuid references public.ai_rules (id),
  reviewed_by uuid not null references public.admin_users (id),
  model text not null,
  prompt_version text not null,
  created_at timestamptz not null default now()
);

comment on table public.ai_corrections is
  'OD-18 corrective loop: one row per human intervention on an AI draft. Append-mostly; the audit_logs table carries the access trail.';

create index ai_corrections_message_idx on public.ai_corrections (message_id);

grant select, insert, delete on public.ai_corrections to service_role;
alter table public.ai_corrections enable row level security;
