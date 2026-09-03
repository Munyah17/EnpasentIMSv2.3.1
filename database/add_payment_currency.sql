-- Currency on a payment, and on the transaction that produced it.
--
-- Run after database/add_exchange_rates.sql and
-- database/add_paynow_multicurrency.sql. Idempotent.
--
-- USD is the base currency: every price is held in USD, and a ZiG price is
-- worked out from it at the rate on record. A payment, though, is recorded
-- in the currency it was ACTUALLY made in -- a ZiG payment stays a ZiG
-- payment and is never converted back into a dollar figure. Converting it
-- back would bake today's rate into a historical record and make the books
-- disagree with the bank.
--
-- amount_usd and amount_zwg are GENERATED from amount and currency rather
-- than written alongside them, so the three can never drift apart. A total
-- per currency is a sum of one column, and rows of the other currency
-- contribute nothing rather than being silently added in at some rate.

ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'
    CHECK (currency IN ('USD', 'ZWG'));

-- Dropped and re-added rather than IF NOT EXISTS: a generated column's
-- expression cannot be altered in place, so this is what makes the migration
-- safe to re-run after the expression changes.
ALTER TABLE public.payments
  DROP COLUMN IF EXISTS amount_usd,
  DROP COLUMN IF EXISTS amount_zwg;

ALTER TABLE public.payments
  ADD COLUMN amount_usd NUMERIC(12,2)
    GENERATED ALWAYS AS (CASE WHEN currency = 'USD' THEN amount END) STORED,
  ADD COLUMN amount_zwg NUMERIC(12,2)
    GENERATED ALWAYS AS (CASE WHEN currency = 'ZWG' THEN amount END) STORED;

CREATE INDEX IF NOT EXISTS payments_currency_idx ON public.payments(currency);

-- The rate a ZiG figure was worked out at, kept on the payment so the price
-- the client was quoted stays reconstructable after the rate moves on. NULL
-- for a USD payment, which needed no conversion.
ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS rate NUMERIC(18,6);

-- The same two facts on the Paynow transaction, recorded at initiate time.
-- usd_amount is what was billed; expected_amount is what Paynow was actually
-- asked for, in `currency`. Keeping both is what lets a ZiG payment be
-- checked against the ZiG figure it was initiated for, while still knowing
-- the USD price it came from.
ALTER TABLE public.paynow_transactions
  ADD COLUMN IF NOT EXISTS usd_amount NUMERIC(12,2),
  ADD COLUMN IF NOT EXISTS rate       NUMERIC(18,6);
