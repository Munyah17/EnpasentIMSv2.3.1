-- One client may hold many policies, but not the same product twice while
-- the first is still in force. The web checkout and the staff form were both
-- happy to issue a second identical policy under one national ID, producing
-- two policy numbers covering the same person for the same product -- which
-- is a double premium and a disputed claim waiting to happen.
--
-- Scoped to live policies only, so a genuinely lapsed, cancelled or expired
-- policy can still be replaced by a new one. Enforced in the database rather
-- than only in the app, because the checkout and the staff form are separate
-- code paths and a rule that matters this much should not depend on every
-- caller remembering it.

CREATE UNIQUE INDEX IF NOT EXISTS policies_one_live_per_client_product
  ON public.policies (client_id, product_id)
  WHERE status IN ('active', 'waiting_period');

-- National IDs identify a person, so the same one must not appear on two
-- client records. Duplicated clients are how the same human ends up with
-- parallel profiles and the check above gets bypassed.
CREATE UNIQUE INDEX IF NOT EXISTS clients_national_id_unique
  ON public.clients (national_id)
  WHERE national_id IS NOT NULL AND national_id <> '';
