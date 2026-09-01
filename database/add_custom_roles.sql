-- Custom roles: Super Admin-defined, named bundles of granular permissions
-- (see src/lib/permissions.ts for the catalog) that can be assigned to a
-- staff member on top of their base system role. The base `profiles.role`
-- enum still drives Postgres RLS (unchanged) — a custom role only changes
-- what profiles.permissions holds, which is an app-layer gate (hasPermission
-- in AuthContext) on top of that RLS tier. Staff/client deletion are never
-- part of this catalog and stay hard-gated to role = 'super_admin' directly
-- in the pages that expose them plus their own RLS policies, so no custom
-- role can ever grant them.
CREATE TABLE IF NOT EXISTS public.custom_roles (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  description TEXT,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS custom_role_id UUID REFERENCES public.custom_roles(id) ON DELETE SET NULL;

ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;

-- Any staff member can read the list (needed to show role names when
-- assigning staff), but only Super Admin can create/edit/delete one.
DROP POLICY IF EXISTS "custom_roles_select_staff" ON public.custom_roles;
CREATE POLICY "custom_roles_select_staff" ON public.custom_roles FOR SELECT TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "custom_roles_write_super_admin" ON public.custom_roles;
CREATE POLICY "custom_roles_write_super_admin" ON public.custom_roles FOR ALL TO authenticated
  USING (current_user_role() = 'super_admin')
  WITH CHECK (current_user_role() = 'super_admin');
