-- Exchange rates, set by hand and kept as history.
--
-- `rate` is units of `currency` per 1 USD (ZiG per 1 USD). The row with the
-- newest effective_date is the one in force; older rows are never edited or
-- deleted, so what a past transaction was converted at stays reconstructable
-- after the rate moves on, and the trend can be charted.
--
-- There is deliberately no default rate and no fallback. With nothing on
-- record, a ZiG payment is refused rather than charged -- sending the USD
-- figure through the ZiG integration unconverted would ask for a fraction of
-- what is owed and mark the premium paid.

CREATE TABLE IF NOT EXISTS public.exchange_rates (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  currency        TEXT NOT NULL DEFAULT 'ZWG' CHECK (currency IN ('ZWG')),
  rate            NUMERIC(18,6) NOT NULL CHECK (rate > 0),
  effective_date  DATE NOT NULL DEFAULT CURRENT_DATE,
  -- 'manual' is a figure someone entered and stands as the official rate.
  -- 'estimate' means it was seeded from a suggestion and should be checked.
  source          TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'estimate')),
  note            TEXT,
  set_by          TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One rate per currency per day: re-entering today's rate corrects it
  -- rather than adding a second row that quietly wins on ordering.
  UNIQUE (currency, effective_date)
);

CREATE INDEX IF NOT EXISTS exchange_rates_currency_date_idx
  ON public.exchange_rates(currency, effective_date DESC);

ALTER TABLE public.exchange_rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.exchange_rates FORCE ROW LEVEL SECURITY;

-- Any staff member can read the rate in force: it is needed wherever an
-- amount is shown. Only an admin can set one, the same bar as app_settings.
DROP POLICY IF EXISTS "exchange_rates_select_staff" ON public.exchange_rates;
CREATE POLICY "exchange_rates_select_staff" ON public.exchange_rates
  FOR SELECT TO authenticated USING (public.is_staff());

DROP POLICY IF EXISTS "exchange_rates_write_admin" ON public.exchange_rates;
CREATE POLICY "exchange_rates_write_admin" ON public.exchange_rates
  FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());
