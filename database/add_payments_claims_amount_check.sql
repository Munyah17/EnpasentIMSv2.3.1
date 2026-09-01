-- Defense in depth: a payment or claim for zero or a negative amount was
-- never rejected anywhere below the application layer.
--
-- db.payments.create/update and db.claims.create now refuse a non-positive
-- amount before writing (see src/lib/db.ts), and the Developer API
-- (api/v1/[...path].ts) already validated this on its own payments
-- endpoint. But nothing stopped a write that skipped those paths --
-- a direct Supabase call, a future endpoint, a bulk import script -- and
-- for payments the consequence is not just a bad number: a $0 or negative
-- payment marked 'completed' still advances the policy's nextPaymentDate
-- and can reinstate a lapsed policy for free (applyCompletedPaymentToPolicy
-- floors at crediting one period no matter what the amount was).
--
-- Before running this: check nothing already on file would violate it --
--   SELECT id, reference, amount FROM public.payments WHERE amount <= 0;
--   SELECT id, claim_number, amount FROM public.claims WHERE amount <= 0;
-- A straight ADD CONSTRAINT aborts entirely if either finds a row, so any
-- existing bad rows need correcting (or the amount itself investigated)
-- before this applies. Added NOT VALID + VALIDATE as two steps rather than
-- one, so an existing violation is reported clearly instead of rolling back
-- the whole statement with no indication of which row was the problem.
ALTER TABLE public.payments
  ADD CONSTRAINT payments_amount_positive CHECK (amount > 0) NOT VALID;
ALTER TABLE public.payments VALIDATE CONSTRAINT payments_amount_positive;

ALTER TABLE public.claims
  ADD CONSTRAINT claims_amount_positive CHECK (amount > 0) NOT VALID;
ALTER TABLE public.claims VALIDATE CONSTRAINT claims_amount_positive;
