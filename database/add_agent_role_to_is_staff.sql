-- The 'agent' work role was added to the app (UserRole type, Staff
-- Management role dropdown, create-account.ts's STAFF_ROLES) but is_staff()
-- was missed — without it, an agent could sign in but every core table
-- (clients, policies, claims, payments, tickets, emails, leads, reminders,
-- chat, login_attempts, app_settings, assessments — everything gated on
-- is_staff()) would silently return empty via RLS.

CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role IN ('super_admin','admin','tech_support','claims_officer','policy_admin','finance','client_relations','agent')
     FROM public.profiles WHERE id = auth.uid()),
    FALSE
  )
$$;
