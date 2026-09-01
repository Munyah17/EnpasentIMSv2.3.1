-- Lets a policyholder see their own claims and payments.
--
-- public.owns_policy(UUID) has existed since the original schema
-- specifically for this (see supabase_schema.sql) but was never actually
-- wired into a SELECT policy on claims or payments -- only "claims_select_
-- staff" / "payments_select_staff" (is_staff()) exist. Postgres RLS
-- policies are OR'd together for a given command, so with no second,
-- permissive policy granting policyholders anything, a policyholder gets
-- zero rows back, full stop.
--
-- The practical effect: src/pages/policyholder/MyClaims.tsx and MyPayments
-- .tsx call db.claims.list() / db.payments.list() exactly as MyPolicies.tsx
-- calls db.policies.list() (which DOES have "policies_select_own"), but for
-- claims and payments the request is silently answered with nothing. Every
-- real policyholder login sees an empty "My Claims" and "My Payments" page,
-- regardless of what is actually on file for them.
--
-- This mirrors "policies_select_own" exactly, just via the existing helper
-- rather than re-deriving the same client-email join by hand.
DROP POLICY IF EXISTS "claims_select_own" ON public.claims;
CREATE POLICY "claims_select_own" ON public.claims FOR SELECT TO authenticated
  USING (public.owns_policy(policy_id));

DROP POLICY IF EXISTS "payments_select_own" ON public.payments;
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated
  USING (public.owns_policy(policy_id));
