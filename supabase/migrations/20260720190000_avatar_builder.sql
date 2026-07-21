-- Build-your-own-avatar (SXU): a student composes her own illustrated
-- portrait from facets (skin, face shape, eyes, nose, mouth, hair, hair
-- colour, crown) instead of picking one of six fixed medallions. The composed
-- choice is a small, non-sensitive set of vocabulary keys — no free text, no
-- photo, nothing regulated — so it needs no encryption; the legacy single-mark
-- column (avatar_key) stays for backward-compatible rendering of profiles
-- saved before the builder existed.
--
-- Additive and non-destructive: a nullable column on an existing table. The
-- table's existing service_role grants and RLS (server-only, reached through
-- the student-profile Edge Function) already cover the new column.

alter table public.student_profiles
  add column avatar_config jsonb;

comment on column public.student_profiles.avatar_config is
  'Composed avatar facet keys {skin,faceShape,eyes,nose,mouth,hair,hairColor,crown}, validated against the avatar vocabulary in the student-profile Edge Function. Non-sensitive; supersedes avatar_key when present.';
