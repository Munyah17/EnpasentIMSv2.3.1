-- ================================================================
-- ENPASSENT IMS — PROFILES + AUTH TRIGGER (for partial rebuilds)
-- Prefer: rebuild_database.sql for a complete one-shot rebuild
-- ================================================================

CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  role        TEXT NOT NULL DEFAULT 'policy_admin'
                CHECK (role IN ('super_admin','admin','claims_officer','policy_admin','finance','client_relations','policyholder')),
  department  TEXT NOT NULL DEFAULT 'Administration',
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, name, role, department)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'policy_admin'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Administration')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();
