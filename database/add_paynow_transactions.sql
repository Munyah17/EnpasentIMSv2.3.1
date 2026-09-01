-- What we expect back from Paynow, recorded the moment a transaction is
-- initiated -- so a later webhook call (or a poll) has something real to
-- reconcile against instead of trusting whatever amount and status arrive
-- on their own.
--
-- Paynow resultUrl is a real webhook (see api/paynow-webhook.ts): Paynow
-- POSTs a status update to it the moment a transaction settles, hash-signed
-- with the integration key so the message's authenticity can be verified.
-- It exists precisely for the case the client-side poll in
-- OnlinePaymentModal.tsx cannot cover: a payer who pays on Paynow's page and
-- then closes the tab before returning. Without a webhook, that payment
-- clears on Paynow's side and this system never finds out.
--
-- A webhook alone is not enough, though: "paid" only tells you the
-- reference cleared, not that it cleared for the amount this transaction
-- was actually for. This table is what makes that comparison possible.
CREATE TABLE IF NOT EXISTS public.paynow_transactions (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference         TEXT NOT NULL UNIQUE,
  policy_id         UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  expected_amount   NUMERIC(10,2) NOT NULL CHECK (expected_amount > 0),
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending', 'paid', 'mismatch', 'failed')),
  paynow_reference  TEXT,
  confirmed_amount  NUMERIC(10,2),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS paynow_transactions_policy_idx ON public.paynow_transactions(policy_id);

ALTER TABLE public.paynow_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paynow_transactions FORCE ROW LEVEL SECURITY;

-- Staff can see these (useful for reconciling a "mismatch" row by hand);
-- nobody, staff included, gets an INSERT/UPDATE/DELETE policy. Every write
-- happens through the service-role key inside api/paynow.ts (at initiate)
-- and api/paynow-webhook.ts (on the status update), both of which validate
-- everything server-side before touching this table.
DROP POLICY IF EXISTS "paynow_transactions_select_staff" ON public.paynow_transactions;
CREATE POLICY "paynow_transactions_select_staff" ON public.paynow_transactions
  FOR SELECT TO authenticated USING (public.is_staff());
