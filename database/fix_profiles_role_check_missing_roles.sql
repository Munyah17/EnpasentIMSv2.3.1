-- CRITICAL FIX: profiles.role's CHECK constraint on the live database was
-- missing both 'agent' (added to the app as a work role this session) and
-- 'api_partner' (used by create-api-developer.ts to create a developer
-- partner's login-disabled identity). Neither role name was ever added to
-- the constraint, so any attempt to create a profile with either role
-- silently failed the on_auth_user_created trigger's INSERT, which rolled
-- back the entire auth.users creation — surfaced to callers as a generic
-- "Database error creating new user". This is what was actually behind
-- weeks of "Register developer (HTTP 404)" reports: the request reached
-- the function fine, but the function's own user-creation step was
-- silently broken.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','tech_support','claims_officer','policy_admin','finance','client_relations','agent','policyholder','api_partner'));
