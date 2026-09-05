-- Lets one Paynow checkout pay for more than one policy, each still
-- credited its own specific, independently-verified amount.
--
-- paynow_transactions.policy_id stays exactly what it always was: one
-- transaction, one policy, NOT NULL, untouched. A cart with several
-- policies still designates one of them as that "primary" policy -- what
-- changes is that the OTHER policies in the same checkout get a row here
-- instead of a separate transaction of their own.
--
-- Deliberately additive, not a replacement: a transaction with zero rows
-- here is the single-policy case exactly as it has always worked, so every
-- existing payment (staff-initiated, or the website's own earlier
-- single-product applications) is completely unaffected. See
-- api/_lib/paynowReconcile.ts for how a line gets credited -- the same
-- credit-one-policy logic paynow_transactions.policy_id already used,
-- reused per line rather than re-derived.
CREATE TABLE IF NOT EXISTS public.paynow_transaction_lines (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference   TEXT NOT NULL REFERENCES public.paynow_transactions(reference) ON DELETE CASCADE,
  policy_id   UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One line per policy per transaction -- a cart cannot apply for the
  -- same policy twice within one checkout.
  UNIQUE (reference, policy_id)
);

CREATE INDEX IF NOT EXISTS paynow_transaction_lines_reference_idx
  ON public.paynow_transaction_lines(reference);

ALTER TABLE public.paynow_transaction_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.paynow_transaction_lines FORCE ROW LEVEL SECURITY;

-- Same posture as paynow_transactions: staff can read (to reconcile a
-- mismatch or explain a total to a client), nobody gets a write policy --
-- every write happens through the service-role key in api/paynow.ts (at
-- initiate) and api/_lib/paynowReconcile.ts (on settlement).
DROP POLICY IF EXISTS "paynow_transaction_lines_select_staff" ON public.paynow_transaction_lines;
CREATE POLICY "paynow_transaction_lines_select_staff" ON public.paynow_transaction_lines
  FOR SELECT TO authenticated USING (public.is_staff());
