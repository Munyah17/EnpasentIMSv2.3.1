-- Agriculture Assessor claims workflow: physical (post-loss) claim
-- assessments and pre-loss policy assessments, plus GPS on the policy
-- itself and a denormalized category on claims so the UI can gate the
-- "physical assessment required" rule without an extra product lookup.

ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(9,6);
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(9,6);
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS category TEXT;

-- Backfill category for existing claims from their policy's product.
UPDATE public.claims c SET category = pr.category
  FROM public.policies p JOIN public.products pr ON pr.id = p.product_id
  WHERE p.id = c.policy_id AND c.category IS NULL;

CREATE TABLE IF NOT EXISTS public.claim_assessments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id            UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  assessor_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  description_of_loss TEXT,
  photos              JSONB NOT NULL DEFAULT '[]',
  assessor_comments   TEXT,
  gps_lat             NUMERIC(9,6),
  gps_lng             NUMERIC(9,6),
  crop_population     TEXT,
  crop_stage          TEXT,
  barn_capacity       TEXT,
  farmer_signature    TEXT,
  assessor_signature  TEXT,
  farmer_selfie       TEXT,
  submitted_at        TIMESTAMPTZ,
  sync_status         TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','pending_sync')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.policy_assessments (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id         UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  assessor_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  crop_type         TEXT,
  crop_population   TEXT,
  plant_date        DATE,
  photos            JSONB NOT NULL DEFAULT '[]',
  notes             TEXT,
  gps_lat           NUMERIC(9,6),
  gps_lng           NUMERIC(9,6),
  sync_status       TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','pending_sync')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.claim_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_assessments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "claim_assessments_select_staff" ON public.claim_assessments FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "claim_assessments_write_staff" ON public.claim_assessments FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());

CREATE POLICY "policy_assessments_select_staff" ON public.policy_assessments FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "policy_assessments_write_staff" ON public.policy_assessments FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
