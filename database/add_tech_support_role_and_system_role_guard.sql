-- New system-tier role: tech_support. System roles (super_admin, admin,
-- tech_support) are now managed on a dedicated "System Access Roles" page,
-- separate from Staff Management (which covers work roles only). See
-- src/pages/SystemAccessRoles.tsx / src/pages/Staff.tsx.
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check CHECK (
  role IN ('super_admin','admin','tech_support','claims_officer','policy_admin','finance','client_relations','policyholder')
);

-- Defense in depth: even though only Super Admin can call the Netlify
-- function that creates/assigns system-tier roles, RLS's profiles_update_admin
-- policy lets ANY admin update ANY profile row, including changing someone's
-- role. This trigger blocks a non-super-admin from moving a row into or out
-- of a system-tier role, regardless of which endpoint the update comes
-- through. Self-updates are already exempted here because the existing
-- lock_privileged_profile_fields_on_self_update trigger freezes `role` on
-- self-edits before this one ever sees a role change.
CREATE OR REPLACE FUNCTION public.block_non_super_admin_system_role_changes()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF NEW.role IS DISTINCT FROM OLD.role
     AND (NEW.role IN ('super_admin','admin','tech_support') OR OLD.role IN ('super_admin','admin','tech_support'))
     AND current_user_role() <> 'super_admin' THEN
    RAISE EXCEPTION 'Only a Super Admin can change a system access role.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_block_non_super_admin_system_role_changes ON public.profiles;
CREATE TRIGGER trg_block_non_super_admin_system_role_changes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_non_super_admin_system_role_changes();
