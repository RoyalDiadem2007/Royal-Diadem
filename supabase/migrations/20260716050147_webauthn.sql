-- WebAuthn / passkeys (Spec §5: biometric login; PIN always remains fallback).
--
-- Deviation from Spec §8, deliberate: credentials live in their own table
-- instead of the single webauthn_credential_id/webauthn_public_key columns on
-- students/admin_users, because (a) a correct WebAuthn implementation MUST
-- store the signature counter to detect cloned authenticators, and (b) girls
-- use phones AND tablets/iPads (Spec §3) — one credential per device. The
-- superseded spec columns stay in place; dropping them is a §2 stop-and-ask
-- tracked in PROJECT_STATE.

create table public.webauthn_credentials (
  id uuid primary key default gen_random_uuid(),
  subject_type text not null check (subject_type in ('student', 'admin')),
  -- students.id or admin_users.id per subject_type (polymorphic; enforced by
  -- the Edge Function layer, same as public.sessions).
  subject_id uuid not null,
  -- Base64url credential id as sent by the authenticator. Globally unique —
  -- this is also how usernameless (discoverable) login finds the account.
  credential_id text not null unique,
  -- Base64url COSE public key. The private key never leaves the device.
  public_key text not null,
  -- Signature counter; a verify with a non-increasing counter is a cloned
  -- authenticator signal and must be rejected.
  counter bigint not null default 0,
  transports text[],
  device_type text check (device_type in ('singleDevice', 'multiDevice')),
  backed_up boolean not null default false,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

comment on table public.webauthn_credentials is
  'Passkey public keys, one row per device. Counter regression = clone signal, reject. Server-side only.';

create index webauthn_credentials_subject_idx
  on public.webauthn_credentials (subject_type, subject_id);

grant select, insert, update, delete on public.webauthn_credentials to service_role;
alter table public.webauthn_credentials enable row level security;
-- No policies: server-side only.

-- Single-use challenges bridging the two halves of each ceremony. Expire fast;
-- consumed (deleted) on first verify attempt regardless of outcome.
create table public.webauthn_challenges (
  id uuid primary key default gen_random_uuid(),
  challenge text not null unique,
  purpose text not null check (purpose in ('registration', 'authentication')),
  -- Set for registration (the logged-in subject); null for usernameless
  -- authentication where the credential itself identifies the account.
  subject_type text check (subject_type in ('student', 'admin')),
  subject_id uuid,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

create index webauthn_challenges_expires_idx on public.webauthn_challenges (expires_at);

grant select, insert, delete on public.webauthn_challenges to service_role;
alter table public.webauthn_challenges enable row level security;
-- No policies: server-side only.
