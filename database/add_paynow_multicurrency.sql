-- Paynow: multi-currency, and the poll URL that makes recovery possible.
--
-- Run after database/add_paynow_transactions.sql. Idempotent.
--
-- currency
--   Paynow has no currency parameter: an integration ID *is* a currency, and
--   we now hold two (USD 16866, ZiG 16867). A status update carries no
--   currency of its own, so unless it is recorded here at initiate time
--   there is no way to tell afterwards which ledger a reference belonged to
--   -- and comparing a ZiG amount against a USD expectation would compare
--   two different things and call them equal.
--
-- poll_url
--   Paynow issues this per transaction and it is the ONLY way to ask about a
--   reference after the fact. Without it stored, a lost webhook is
--   unrecoverable: the payment cleared on Paynow's side and nothing here can
--   ever find out. With it, api/paynow-reconcile.ts can re-poll every
--   pending transaction and settle it. This is the fix for "sometimes
--   payments go through but the app fails to confirm".

ALTER TABLE public.paynow_transactions
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD',
  ADD COLUMN IF NOT EXISTS poll_url TEXT;

-- Rows predating this column were all USD (the only integration that
-- existed), so the DEFAULT above backfills them correctly.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.constraint_column_usage
    WHERE table_name = 'paynow_transactions' AND constraint_name = 'paynow_transactions_currency_check'
  ) THEN
    ALTER TABLE public.paynow_transactions
      ADD CONSTRAINT paynow_transactions_currency_check CHECK (currency IN ('USD', 'ZWG'));
  END IF;
END $$;

-- The sweep in api/paynow-reconcile.ts selects exactly this: still pending,
-- oldest first, within an age window.
CREATE INDEX IF NOT EXISTS paynow_transactions_pending_idx
  ON public.paynow_transactions(status, created_at)
  WHERE status = 'pending';

-- No RLS change. Every write still happens through the service-role key in
-- api/paynow.ts, api/paynow-webhook.ts and api/paynow-reconcile.ts, each of
-- which validates server-side before touching this table; staff keep
-- SELECT so a 'mismatch' row can be reconciled by hand.
