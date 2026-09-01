-- Lets Super Admin/Admin capture fraud patterns they've actually seen in
-- the field (e.g. "photos reused across multiple farmers in the same
-- ward") as plain-language rules, instead of fraud detection only ever
-- knowing the handful of red flags hardcoded into the scoring prompt.
-- Active rules are read by api/score-claim-fraud.ts (service role, bypasses
-- RLS) and folded into the AI prompt as extra named checks on every claim.

CREATE TABLE IF NOT EXISTS public.fraud_signal_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.fraud_signal_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_signal_rules FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fraud_signal_rules_select_staff" ON public.fraud_signal_rules;
CREATE POLICY "fraud_signal_rules_select_staff" ON public.fraud_signal_rules FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "fraud_signal_rules_write_admin" ON public.fraud_signal_rules;
CREATE POLICY "fraud_signal_rules_write_admin" ON public.fraud_signal_rules FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
