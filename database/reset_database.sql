-- ================================================================
-- ENPASSENT IMS — RESET DATABASE (for partial / manual rebuilds)
-- Prefer: rebuild_database.sql for a complete one-shot rebuild
-- ================================================================

-- Drop all RLS policies first
DO $$
DECLARE
  pol RECORD;
BEGIN
  FOR pol IN
    SELECT policyname, tablename
    FROM pg_policies
    WHERE schemaname = 'public'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

-- Drop tables with CASCADE (handles foreign keys)
DROP TABLE IF EXISTS public.reminders CASCADE;
DROP TABLE IF EXISTS public.fraud_cases CASCADE;
DROP TABLE IF EXISTS public.leads CASCADE;
DROP TABLE IF EXISTS public.emails CASCADE;
DROP TABLE IF EXISTS public.tickets CASCADE;
DROP TABLE IF EXISTS public.payments CASCADE;
DROP TABLE IF EXISTS public.claims CASCADE;
DROP TABLE IF EXISTS public.policies CASCADE;
DROP TABLE IF EXISTS public.products CASCADE;
DROP TABLE IF EXISTS public.clients CASCADE;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- Drop triggers
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP TRIGGER IF EXISTS clients_updated_at ON public.clients;
DROP TRIGGER IF EXISTS policies_updated_at ON public.policies;
DROP TRIGGER IF EXISTS tickets_updated_at ON public.tickets;

-- Drop functions
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;
DROP FUNCTION IF EXISTS public.current_user_role() CASCADE;
DROP FUNCTION IF EXISTS public.is_staff() CASCADE;
DROP FUNCTION IF EXISTS public.is_admin() CASCADE;
DROP FUNCTION IF EXISTS public.owns_policy(UUID) CASCADE;
DROP FUNCTION IF EXISTS public.set_updated_at() CASCADE;
