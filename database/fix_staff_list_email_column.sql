-- Fix: db.ts's staff.list() selected `*, users:id(email)`, trying to embed
-- a `users` table that doesn't exist in this schema (email lives in
-- auth.users, which PostgREST can't embed across schemas, and which the
-- authenticated role has no grant on anyway). This has always failed with
-- PGRST201 ("more than one relationship was found"), since profiles.id is
-- referenced by five other tables' foreign keys and PostgREST can't guess
-- which one "users:id" was supposed to mean — so staff.list() has always
-- silently fallen back to stale local mock data.
--
-- Fix: store email directly on profiles (populated at signup, kept in sync
-- if it changes), so listing staff is a plain `select('*')` with no embed.
--
-- Run this once in the Supabase SQL Editor against the live database.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS email TEXT;

UPDATE public.profiles p SET email = u.email
FROM auth.users u
WHERE p.id = u.id AND p.email IS NULL;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, department, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'policy_admin'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Administration'),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

-- Keep profiles.email in sync if the auth email changes later (e.g. via
-- Profile.tsx's "Update Email" flow, once the user confirms it).
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();
