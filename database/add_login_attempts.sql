-- Login attempt log, for real brute-force detection on System Health
-- (previously that page only ever showed simulated/no security data).
-- Insertable pre-auth (failed attempts have no session yet), but only
-- readable by staff so the log itself can't be used to harvest emails.

CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL,
  success    BOOLEAN NOT NULL,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ts ON public.login_attempts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON public.login_attempts(email);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY "login_attempts_insert_anon" ON public.login_attempts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "login_attempts_insert_auth" ON public.login_attempts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "login_attempts_select_staff" ON public.login_attempts FOR SELECT TO authenticated USING (is_staff());

-- Keep the table small — periodic trim of anything older than 7 days,
-- invoked opportunistically from the client (see db.ts loginAttempts.log).
CREATE OR REPLACE FUNCTION public.trim_login_attempts()
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.login_attempts WHERE ts < NOW() - INTERVAL '7 days'
$$;
