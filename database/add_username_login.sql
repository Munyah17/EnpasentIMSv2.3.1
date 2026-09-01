-- Lets staff sign in with their full name instead of email, from the same
-- login field. Supabase Auth only ever authenticates by email/phone, so the
-- client must resolve a typed name to an email BEFORE calling
-- signInWithPassword — but profiles_select only grants SELECT to
-- `authenticated`, and there's no session yet at that point in the login
-- flow. This RPC bridges the gap: SECURITY DEFINER lets it read profiles
-- despite RLS, but it only ever returns a bare email (never any other
-- profile column), and only when the name matches exactly one active
-- profile — an ambiguous or unmatched name returns NULL, which the client
-- treats as "invalid credentials" same as a wrong password.
--
-- Run this once in the Supabase SQL Editor against the live database.

CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier TEXT)
RETURNS TEXT LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_email TEXT;
  v_count INT;
BEGIN
  SELECT COUNT(*), MIN(email) INTO v_count, v_email
  FROM public.profiles
  WHERE lower(name) = lower(trim(p_identifier)) AND active = true AND email IS NOT NULL;

  IF v_count = 1 THEN
    RETURN v_email;
  END IF;
  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(TEXT) TO anon, authenticated;
