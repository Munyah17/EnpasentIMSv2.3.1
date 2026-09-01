-- Pre-Loss Assessment was agriculture-only (crop type, crop population,
-- plant date). Extends it to vehicle/comprehensive-cover policies —
-- recording a car's condition before cover starts, so a later claim can be
-- checked against a real baseline the same way an agriculture claim is
-- checked against a farm's pre-loss photos.

ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS subject_type TEXT NOT NULL DEFAULT 'agriculture' CHECK (subject_type IN ('agriculture','vehicle'));
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS registration_number TEXT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS vehicle_make TEXT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS vehicle_model TEXT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS odometer_reading TEXT;
ALTER TABLE public.policy_assessments ADD COLUMN IF NOT EXISTS existing_damage TEXT;
ALTER TABLE public.policy_assessments ALTER COLUMN crop_type DROP NOT NULL;
