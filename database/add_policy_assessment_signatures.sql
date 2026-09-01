-- Pre-Loss Assessment (policy_assessments) gets the same farmer/assessor
-- sign-off already required on the post-loss Physical Assessment
-- (claim_assessments) -- both sides of an agriculture/vehicle claim now
-- carry a signed record, not just the claim-time one.

ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS farmer_signature TEXT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS assessor_signature TEXT;
