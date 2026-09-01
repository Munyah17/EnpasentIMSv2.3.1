-- Expands api_developers with the minimum real governance a B2B API
-- partner program needs: proof of terms acceptance, and a genuine
-- "terminated" end-state distinct from a temporary "suspended" one
-- (terminated is permanent — no reactivate path — and always carries a
-- reason). Full legal MOU terms are still a business decision for
-- directors; this wires up the mechanism so it's ready once that text is
-- finalized (see src/lib/apiTerms.ts for the placeholder draft shown at
-- registration time today).
--
-- Run this once in the Supabase SQL Editor against the live database.

ALTER TABLE public.api_developers ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE public.api_developers ADD COLUMN IF NOT EXISTS terms_version TEXT;
ALTER TABLE public.api_developers ADD COLUMN IF NOT EXISTS terminated_at TIMESTAMPTZ;
ALTER TABLE public.api_developers ADD COLUMN IF NOT EXISTS termination_reason TEXT;

ALTER TABLE public.api_developers DROP CONSTRAINT IF EXISTS api_developers_status_check;
ALTER TABLE public.api_developers ADD CONSTRAINT api_developers_status_check
  CHECK (status IN ('active', 'suspended', 'terminated'));
