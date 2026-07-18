-- share-media bucket (Phase 10b, Spec §6.8 + docs/SUPABASE_RULES.md §7):
-- Share photos live in a PRIVATE bucket. No storage policies are created for
-- anon or authenticated on purpose — with RLS on and no policy, direct
-- client access is denied entirely. Every upload goes through the share
-- Edge Function (session + Turnstile + rate limit + validation) and every
-- read is a short-lived signed URL minted server-side after the feed's own
-- visibility rules ran. Path convention: {student_id}/{post_id} so the
-- function can authorize by prefix.
--
-- 5 MiB cap and image-only MIME types enforced at the bucket level too —
-- defense-in-depth under the Edge Function's own validation.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'share-media',
  'share-media',
  false,
  5242880, -- 5 MiB
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do nothing;
