-- payments.method rejected methods the app can actually produce, so those
-- payments failed at the database instead of being recorded:
--
--   'Stop Order' - how agriculture premiums are collected (annual stop
--                  order), offered on every policy and payment form.
--   'Zipit'      - written by the online payment modal's bank transfer
--                  rail (ZimSwitch ZIPIT).
--
-- 'Airtime Balance' is dropped in the same pass: premiums are not paid out
-- of an airtime balance, and it was only ever there because the list had
-- been re-typed by hand in five places and drifted. 'Card' goes too --
-- card payments arrive through Paynow's hosted page and are recorded as
-- Paynow, so a separate card entry never had a writer.
--
-- The constraint now matches PAYMENT_METHODS in src/types/index.ts exactly,
-- which is the single list the forms are built from.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
  CHECK (method IN (
    'EcoCash',
    'OneMoney',
    'InnBucks',
    'Bank Transfer',
    'Cash',
    'Debit Order',
    'Stop Order',
    'Paynow',
    'Zipit'
  ));
