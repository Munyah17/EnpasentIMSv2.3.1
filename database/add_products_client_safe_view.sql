-- A client-safe read of the products catalogue.
--
-- "products_select" (see supabase_schema.sql) is USING (true) for any
-- authenticated user, staff and policyholders alike -- and that is
-- deliberate, since browsing the catalogue is exactly what a client needs
-- to do. The problem is not the row, it is the columns: a bare
-- `select('*')` against public.products also hands back commission_pct
-- (the broker's margin on that product) and policies_count (book size per
-- product), to anyone who opens their browser's network tab while logged
-- in with no special permissions. Both are genuine trade secrets -- neither
-- is something a client, or a competitor posing as one, should ever be able
-- to read off the wire.
--
-- RLS is row-level only; it cannot narrow which columns a row exposes. The
-- fix is a view that simply never selects the sensitive columns, so no
-- caller of it can retrieve them by asking differently.
CREATE OR REPLACE VIEW public.products_client_safe
WITH (security_invoker = true) -- runs as the querying user; row visibility
                                -- still comes from products_select's own
                                -- RLS, this view only narrows the columns.
AS
SELECT
  id, name, code, category, premium, cover_amount, waiting_period_days,
  min_age, max_age, active, features, description, excess
FROM public.products;

-- A view is its own object and needs its own grant even though the
-- underlying table already permits the read.
GRANT SELECT ON public.products_client_safe TO authenticated;

COMMENT ON VIEW public.products_client_safe IS
  'Client-facing product catalogue. Excludes commission_pct and policies_count -- see src/types/index.ts ClientSafeProduct and src/lib/db.ts products.listClientSafe(). Staff pages keep reading the base products table directly.';
