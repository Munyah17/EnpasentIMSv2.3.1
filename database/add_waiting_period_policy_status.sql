-- New policy lifecycle stage: waiting_period. pending = awaiting admin
-- approval (unchanged); waiting_period = approved (or created directly) but
-- not yet claims-eligible — see src/lib/policyLifecycle.ts for the rules
-- that move a policy into/out of it.
ALTER TABLE public.policies DROP CONSTRAINT IF EXISTS policies_status_check;
ALTER TABLE public.policies ADD CONSTRAINT policies_status_check CHECK (
  status IN ('active','waiting_period','lapsed','cancelled','pending','expired')
);
