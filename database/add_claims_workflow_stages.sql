-- Multi-stage claims pipeline: intake (Claims Receiver) → assessment
-- (Claims Processor) → final_review (MD/COO) → closed. `status` still
-- carries the outcome; `stage` carries who needs to act on it next.
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'intake'
  CHECK (stage IN ('intake','assessment','final_review','closed'));
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS assessment_notes TEXT;
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS agent_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Backfill existing claims (created before this pipeline existed) to a
-- sensible stage based on their current outcome, so nothing already
-- pending/under review vanishes from every reviewer's queue.
UPDATE public.claims SET stage = 'intake' WHERE status = 'pending';
UPDATE public.claims SET stage = 'assessment' WHERE status = 'under_review';
UPDATE public.claims SET stage = 'closed' WHERE status IN ('approved','rejected','paid');

-- Backfill agent_id from each claim's underlying policy, so existing claims
-- are attributed the same way new ones will be going forward.
UPDATE public.claims c SET agent_id = p.agent_id
  FROM public.policies p WHERE p.id = c.policy_id AND p.agent_id IS NOT NULL;

-- Give the built-in claims_officer role the two new stage permissions too,
-- so a claims_officer can run the whole intake → assessment → final review
-- pipeline solo by default until a Super Admin sets up dedicated "Claims
-- Receiver" / "Claims Processor" / "Final Reviewer" custom roles for proper
-- segregation of duties (see src/components/modals/RoleManagerModal.tsx).
UPDATE public.profiles SET permissions = ARRAY[
  'claims.view','claims.create','claims.edit','claims.intake','claims.assess',
  'claims.approve','claims.reject','communications.send_email'
] WHERE role = 'claims_officer';
