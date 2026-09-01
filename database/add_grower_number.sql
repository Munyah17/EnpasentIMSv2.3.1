-- Grower Number — agriculture policies only. Optional free-text field for
-- the grower's registration number with the insurer.
ALTER TABLE policies ADD COLUMN IF NOT EXISTS grower_number TEXT;
