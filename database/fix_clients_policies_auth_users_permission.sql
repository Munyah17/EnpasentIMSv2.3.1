-- Fix: clients_select_own and policies_select_own both query `auth.users`
-- directly inside a RLS policy USING clause. Unlike the is_staff()/is_admin()/
-- current_user_role() helper functions (all SECURITY DEFINER, so they run
-- with elevated privileges), a plain policy expression runs with the
-- QUERYING role's own privileges — and the `authenticated` role has no
-- grant on auth.users. Worse: because Postgres must evaluate every
-- permissive policy's USING clause to OR them together, this doesn't just
-- make clients_select_own return false for staff — it makes the ENTIRE
-- query on `clients` throw "permission denied for table users", which
-- then breaks EVERY other query that embeds clients (policies, claims,
-- payments, tickets, fraud_cases, reminders — nearly everything), for
-- every authenticated user, all the time. This is why the app has been
-- silently running on stale local-storage fallback data everywhere.
--
-- Fix: move the auth.users lookup into a SECURITY DEFINER helper function
-- (same pattern as is_staff()/is_admin()), so it runs with elevated
-- privileges regardless of who's querying.
--
-- Run this once in the Supabase SQL Editor against the live database.

CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

DROP POLICY IF EXISTS "clients_select_own" ON public.clients;
CREATE POLICY "clients_select_own" ON public.clients FOR SELECT TO authenticated USING (
  email = public.current_user_email()
);

DROP POLICY IF EXISTS "policies_select_own" ON public.policies;
CREATE POLICY "policies_select_own" ON public.policies FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id
      AND c.email = public.current_user_email()
  )
);
