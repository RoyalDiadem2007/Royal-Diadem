-- Auth support (Phase 2).
--
-- 1. students.login_code — the login identifier ("crown code", e.g. RD-7F3K)
--    printed on each student's PIN card. A PIN alone cannot be the credential:
--    it would have to be globally unique, and verifying it would mean running
--    bcrypt against every student row (O(n) DoS). Identifier + PIN keeps the
--    lookup O(1) and lets rate limiting key on the identifier. Admins log in
--    with email + PIN (admin_users.email is already unique).
--
-- 2. auth_rate_limits — persistent limiter state (CLAUDE.md §10): strict
--    attempt limiting with lockout, keyed by identity AND by IP, enforced in
--    Edge Functions, fail-closed.

alter table public.students
  add column login_code text unique;

comment on column public.students.login_code is
  'Student login identifier (crown code), generated at enrollment alongside the PIN. Unique, non-secret, printed on the PIN card.';

create table public.auth_rate_limits (
  -- e.g. 'login:id:rd-7f3k' or 'login:ip:203.0.113.7' (lowercased)
  limit_key text primary key,
  window_start timestamptz not null default now(),
  attempt_count int not null default 0,
  locked_until timestamptz
);

comment on table public.auth_rate_limits is
  'Login attempt counters + lockouts (CLAUDE.md §10). Managed only by Edge Functions; limiter errors deny the request (fail closed).';

create index auth_rate_limits_locked_idx on public.auth_rate_limits (locked_until);

grant select, insert, update, delete on public.auth_rate_limits to service_role;
alter table public.auth_rate_limits enable row level security;
-- No policies: server-side only.

-- Atomic attempt recording (CLAUDE.md §7: no read-modify-write races).
-- One call = one attempt counted, window rolled, lockout applied — all in a
-- single statement path so concurrent logins cannot slip past the limit.
create function public.record_auth_attempt(
  p_key text,
  p_max_attempts int,
  p_window_seconds int,
  p_lockout_seconds int
) returns table (allowed boolean, retry_after_seconds int)
language plpgsql
as $$
declare
  v_now timestamptz := now();
  v_row public.auth_rate_limits;
begin
  insert into public.auth_rate_limits as rl (limit_key, window_start, attempt_count, locked_until)
  values (p_key, v_now, 1, null)
  on conflict (limit_key) do update set
    window_start = case
      when rl.window_start < v_now - make_interval(secs => p_window_seconds) then v_now
      else rl.window_start
    end,
    attempt_count = case
      when rl.window_start < v_now - make_interval(secs => p_window_seconds) then 1
      else rl.attempt_count + 1
    end
  returning * into v_row;

  if v_row.locked_until is not null and v_row.locked_until > v_now then
    return query
      select false, greatest(1, ceil(extract(epoch from (v_row.locked_until - v_now)))::int);
    return;
  end if;

  if v_row.attempt_count > p_max_attempts then
    update public.auth_rate_limits
      set locked_until = v_now + make_interval(secs => p_lockout_seconds)
      where limit_key = p_key;
    return query select false, p_lockout_seconds;
    return;
  end if;

  return query select true, 0;
end;
$$;

-- Successful login clears the identifier's counter (not the IP counter).
create function public.clear_auth_attempts(p_key text) returns void
language sql
as $$
  delete from public.auth_rate_limits where limit_key = p_key;
$$;

-- Postgres grants EXECUTE to PUBLIC by default — these are server-only.
revoke execute on function public.record_auth_attempt(text, int, int, int) from public;
revoke execute on function public.clear_auth_attempts(text) from public;
grant execute on function public.record_auth_attempt(text, int, int, int) to service_role;
grant execute on function public.clear_auth_attempts(text) to service_role;
