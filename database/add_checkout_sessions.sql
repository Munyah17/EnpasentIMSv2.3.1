-- Public self-service checkout — a visitor on motions-website applies for
-- cover, pays via Paynow (hosted checkout: EcoCash/OneMoney/InnBucks/Omari/
-- ZIPIT/POS2U/Card) or EcoCash Instant (direct C2B push), and on CONFIRMED
-- payment (Paynow resulturl webhook, or EcoCash poll) we create the real
-- client + policy + payment rows and mark this session 'paid'. The site
-- itself never touches card/mobile-money details -- it only ever gets a
-- redirect URL (Paynow) or a poll reference (EcoCash) back from the
-- gateway. Only ever written by service-role Vercel functions (motions-
-- website/api/create-checkout.ts, paynow-webhook.ts, checkout-status.ts) --
-- no anon/authenticated insert path exists.

CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference           TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  gateway             TEXT NOT NULL CHECK (gateway IN ('paynow','ecocash_instant')),
  payment_method      TEXT,
  gateway_poll_url    TEXT,
  gateway_txn_id      TEXT,
  amount              NUMERIC(10,2) NOT NULL,
  product_id          UUID NOT NULL REFERENCES public.products(id),
  client_name         TEXT NOT NULL,
  client_email        TEXT NOT NULL,
  client_phone        TEXT NOT NULL,
  client_national_id  TEXT NOT NULL,
  client_dob          DATE,
  client_address       TEXT,
  client_occupation    TEXT,
  dependants          JSONB NOT NULL DEFAULT '[]',
  policy_id           UUID REFERENCES public.policies(id),
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "checkout_sessions_select_staff" ON public.checkout_sessions;
CREATE POLICY "checkout_sessions_select_staff" ON public.checkout_sessions FOR SELECT TO authenticated USING (is_staff());
-- No INSERT/UPDATE/DELETE policy for any authenticated/anon role on purpose
-- -- every write goes through the service-role key inside the three
-- Vercel functions above, which validate everything server-side.
