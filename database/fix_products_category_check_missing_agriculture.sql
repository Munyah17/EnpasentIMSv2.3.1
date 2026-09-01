-- The live products_category_check constraint was never updated when the
-- 'agriculture' category was introduced (supabase_schema.sql already had it
-- correct, but the deployed database's actual constraint was stale) — same
-- class of bug as fix_profiles_role_check_missing_roles.sql. This silently
-- forced the "Field To Floor" agriculture product into category='funeral'
-- at some point, which broke the Agriculture Insurance page (filters by
-- category='agriculture'), premium period display (/mo vs /yr), and the
-- agriculture instant-activation waiting-period logic all at once.

ALTER TABLE products DROP CONSTRAINT products_category_check;
ALTER TABLE products ADD CONSTRAINT products_category_check
  CHECK (category = ANY (ARRAY['life','funeral','health','accident','motor','property','agriculture']));

-- One-time data fix for the affected product.
UPDATE products SET category = 'agriculture', waiting_period_days = 0
WHERE name = 'Field To Floor' AND category = 'funeral';
