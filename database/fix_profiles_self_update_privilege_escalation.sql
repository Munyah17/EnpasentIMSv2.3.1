-- Fix: profiles_update_own allows a user to update EVERY column on their own
-- row, including role, active, permissions, and department. Since RLS only
-- filters which ROWS a policy applies to (not which columns), any
-- authenticated user could currently call:
--   supabase.from('profiles').update({ role: 'super_admin' }).eq('id', myId)
-- and self-promote, bypassing every role check in the UI entirely.
--
-- This adds a BEFORE UPDATE trigger that locks role/active/permissions/
-- department to their existing values whenever a user is updating their own
-- row — self-service edits (Profile page: name, phone) go through unchanged,
-- but privileged fields can only ever be changed by an admin editing
-- SOMEONE ELSE's row (via profiles_update_admin), never one's own.
--
-- Run this once in the Supabase SQL Editor against the live database.

CREATE OR REPLACE FUNCTION public.lock_privileged_profile_fields_on_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() = OLD.id THEN
    NEW.role        := OLD.role;
    NEW.active       := OLD.active;
    NEW.permissions  := OLD.permissions;
    NEW.department   := OLD.department;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_privileged_profile_fields ON public.profiles;
CREATE TRIGGER trg_lock_privileged_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.lock_privileged_profile_fields_on_self_update();
