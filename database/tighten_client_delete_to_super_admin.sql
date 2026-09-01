-- Client deletion was already possible for any admin (clients_delete_admin,
-- USING is_admin()) — tightened to Super Admin only, per explicit request.
-- Policies/claims still block deletion via their own ON DELETE RESTRICT
-- foreign keys (a client with any policy can't be deleted at all, from
-- either role) — this only changes who can delete a client that has none.
--
-- Run this once in the Supabase SQL Editor against the live database.

DROP POLICY IF EXISTS "clients_delete_admin" ON public.clients;
CREATE POLICY "clients_delete_super_admin" ON public.clients
  FOR DELETE TO authenticated USING (current_user_role() = 'super_admin');
