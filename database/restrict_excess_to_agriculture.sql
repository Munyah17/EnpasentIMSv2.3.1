-- Policy excess belongs to agriculture cover and to nothing else.
--
-- The excess column was open to every category, and the policy document
-- printed a POLICY EXCESS section for all of them -- defaulting to
-- agriculture's "15% of loss" whenever a product had none set. Funeral,
-- life, health, accident, motor and property policyholders were therefore
-- handed documents stating a deductible their cover does not carry.
--
-- The app no longer offers the field outside agriculture (see
-- src/components/modals/AddProductModal.tsx) and no longer prints the
-- section (src/lib/exportUtils.ts). This clears what was already saved and
-- stops it coming back.

-- 1. Clear every excess sitting on a non-agriculture product.
UPDATE public.products
   SET excess = NULL
 WHERE excess IS NOT NULL
   AND category <> 'agriculture';

-- 2. Refuse to store one again. Policies read their excess through the
--    product join (see toPolicy in src/lib/db.ts), so this single
--    constraint covers every policy and every document generated from one.
ALTER TABLE public.products DROP CONSTRAINT IF EXISTS products_excess_agriculture_only;
ALTER TABLE public.products ADD CONSTRAINT products_excess_agriculture_only
  CHECK (excess IS NULL OR category = 'agriculture');
