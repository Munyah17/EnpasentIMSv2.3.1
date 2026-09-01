-- Tobacco loss assessment, captured per peril and used to derive the
-- payable claim rather than letting an assessor type an amount in.
--
-- Hail / windstorm are counted in the field (damaged leaves against total
-- leaves at topping). Barn fire is counted in the barn (strings x leaves
-- per string) but still measured against the whole expected crop, since
-- that is what was insured.

ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS hectares NUMERIC(10,2);
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS leaves_expected INT;

-- Hail / windstorm
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS damaged_leaves INT;

-- Barn fire
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS barn_strings INT;
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS leaves_per_string INT;
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS leaves_lost INT;

-- Derived figures, stored alongside their inputs so a historical claim can
-- always be reconciled even if the rates are changed later.
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS percentage_loss NUMERIC(6,3);
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS gross_loss NUMERIC(14,2);
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS handling_expenses NUMERIC(14,2);
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS excess_amount NUMERIC(14,2);
ALTER TABLE public.claim_assessments ADD COLUMN IF NOT EXISTS claim_payable NUMERIC(14,2);

-- Barn detail belongs on the pre-loss record: capacity and condition are
-- established before any fire, and the ownership/usage declaration is taken
-- up front so it cannot be reshaped after a loss.
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS barn_hooks INT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS barn_tiers INT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS barn_bays INT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS barn_ownership TEXT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS barn_usage TEXT;
