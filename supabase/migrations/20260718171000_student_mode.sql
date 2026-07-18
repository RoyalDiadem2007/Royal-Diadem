-- Student Mode (Maria, 2026-07-18): each admin gets a companion STAFF student
-- identity — a real students row linked to its owning admin — to try the
-- student experience and participate alongside the girls (their own crown
-- checks and journal). A student-mode session is a real 'student' session
-- pointing at that row, so every student Edge Function (crown check, journal,
-- encryption, keyword flags, AI paths) runs unchanged end to end. Real
-- students' data stays admin-read-only through the existing admin endpoints;
-- staff rows are labeled and excluded from population stats.

alter table public.students
  add column staff_owner_admin_id uuid references public.admin_users (id);

comment on column public.students.staff_owner_admin_id is
  'Non-null marks a STAFF student identity owned by this admin (Student Mode). Staff rows never belong to real girls: no login_code, unusable PIN, adult DOB, excluded from population stats, labeled in admin surfaces.';

-- One staff identity per admin; real students stay unconstrained (null).
create unique index students_staff_owner_key
  on public.students (staff_owner_admin_id)
  where staff_owner_admin_id is not null;
