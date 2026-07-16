-- Opt in early to the 2026 Data API behavior (docs/SUPABASE_RULES.md §2):
-- new tables in public get NO automatic grants. Every table must be exposed
-- deliberately, per role, in its own migration. Default-deny everywhere.

alter default privileges for role postgres in schema public
  revoke select, insert, update, delete on tables from anon, authenticated, service_role;

alter default privileges for role postgres in schema public
  revoke usage, select on sequences from anon, authenticated, service_role;
