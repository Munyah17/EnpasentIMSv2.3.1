-- Policy excess/deductible, set per-product by staff, printed on the
-- Policy Report PDF below "Cover Provided". Free text so it can express
-- either a flat amount or a percentage-with-minimum clause.

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS excess TEXT;
