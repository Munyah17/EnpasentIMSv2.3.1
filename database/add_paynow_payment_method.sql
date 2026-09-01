-- Paynow is a payment method the business actually uses, but it was missing
-- from the payments.method CHECK constraint. Every web checkout paid through
-- Paynow therefore created a policy and then failed to record its payment,
-- which left the checkout session unfinished and caused the browser's status
-- poll to provision the same policy again every few seconds.
--
-- 'Card' is included alongside it: Paynow's hosted page also settles Visa /
-- Mastercard, and staff need somewhere truthful to record that.

ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE public.payments ADD CONSTRAINT payments_method_check
  CHECK (method IN ('EcoCash', 'OneMoney', 'InnBucks', 'Bank Transfer', 'Cash', 'Debit Order', 'Paynow', 'Card'));

-- Provisioning needs a state that means "a policy is being created for this
-- session right now", so a second concurrent poll can tell the difference
-- between work not started and work in flight, and stand down instead of
-- creating a duplicate policy.
ALTER TABLE public.checkout_sessions DROP CONSTRAINT IF EXISTS checkout_sessions_status_check;
ALTER TABLE public.checkout_sessions ADD CONSTRAINT checkout_sessions_status_check
  CHECK (status IN ('pending', 'provisioning', 'paid', 'failed', 'cancelled'));
