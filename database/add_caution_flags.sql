-- Caution flags were previously stored client-side in localStorage, so a
-- flag raised by one staff member's reminder-check run was invisible to
-- every other staff member's browser — including whoever reviews claims,
-- where a caution flag is supposed to trigger extra scrutiny. Moving it to
-- a real table makes it shared, durable state instead of a per-browser cache.

CREATE TABLE IF NOT EXISTS public.caution_flags (
  policy_id        UUID PRIMARY KEY REFERENCES public.policies(id) ON DELETE CASCADE,
  policy_number    TEXT NOT NULL,
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name      TEXT NOT NULL,
  agent_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  days_overdue     INTEGER NOT NULL DEFAULT 0,
  flagged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  months_defaulted INTEGER NOT NULL DEFAULT 1,
  cleared          BOOLEAN NOT NULL DEFAULT FALSE,
  cleared_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_caution_flags_cleared ON public.caution_flags(cleared);

ALTER TABLE public.caution_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caution_flags FORCE ROW LEVEL SECURITY;

CREATE POLICY "caution_flags_select" ON public.caution_flags FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "caution_flags_write"  ON public.caution_flags FOR ALL    TO authenticated USING (is_staff()) WITH CHECK (is_staff());

ALTER PUBLICATION supabase_realtime ADD TABLE public.caution_flags;
ALTER TABLE public.caution_flags REPLICA IDENTITY FULL;
