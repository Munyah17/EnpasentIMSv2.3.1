-- Renames policies.beneficiaries -> policies.dependants and updates its
-- JSON shape: dependants are people the policyholder carries and pays
-- cover for independently (their own plan/premium, never exceeding the
-- policyholder's own premium), not payout-share beneficiaries — so the
-- old { name, relationship, percentage, phone } shape is replaced by
-- { name, relationship, dob, nationalId, productId, productName, premium,
-- phone }. Safe to run directly: policies is empty in production at the
-- time of this migration, so there is no existing data to reshape.
--
-- Run this once in the Supabase SQL Editor against the live database.

ALTER TABLE public.policies RENAME COLUMN beneficiaries TO dependants;
