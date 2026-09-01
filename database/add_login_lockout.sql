-- Locks sign-in after 5 consecutive failed attempts for one email.
--
-- login_attempts has existed since the original schema and logged every
-- attempt, but nothing ever read it to stop one -- it was an audit trail,
-- not a defence. Whatever throttling existed was only whatever Supabase
-- Auth applies by default, which this app never configured or could rely
-- on. This closes that gap: 5 failures in a row (broken by any success in
-- between) blocks further attempts until a human clears it.
--
-- Runs as a SECURITY DEFINER function, the same pattern as
-- resolve_login_email, because the check has to work for someone who is not
-- signed in yet -- login_attempts' own RLS only grants SELECT to staff, and
-- an anon caller needs an answer to "is this email locked?" without being
-- handed read access to the whole attempts table (which would leak who
-- else has been failing logins).
--
-- Unlocking is not self-service and not time-limited on purpose -- 5 wrong
-- attempts is treated as worth a human looking at it, not something that
-- should quietly go away on its own after a countdown. AuthContext.tsx's
-- login() tells the user to email admin@enpassent.co.zw; an admin clears it
-- by deleting that email's rows from login_attempts (or waiting for
-- trim_login_attempts' normal 7-day sweep, which clears it as a side
-- effect once none of the failures are recent enough to remain).
CREATE OR REPLACE FUNCTION public.is_login_locked(p_email TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*) = 5 FROM (
    SELECT success FROM public.login_attempts
    WHERE email = lower(trim(p_email))
    ORDER BY ts DESC
    LIMIT 5
  ) recent
  WHERE NOT success
$$;

REVOKE ALL ON FUNCTION public.is_login_locked(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_login_locked(TEXT) TO anon, authenticated;
