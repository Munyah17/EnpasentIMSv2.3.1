-- Supersedes add_username_login.sql's name-based lookup: a person's full
-- name isn't a username, so this adds a real `username` column (a short,
-- self-chosen nickname, distinct from `name`) and repoints
-- resolve_login_email() at it. Existing accounts are backfilled with a
-- role-grouped sequential default ("Admin 1", "Agent 1", "User 1", ...,
-- numbered in created_at order within each group) — editable afterwards
-- from Profile (self-service) or Staff management (admin). New accounts
-- are always given a real username up front via the staff-creation modal.
--
-- Run this once in the Supabase SQL Editor against the live database.

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS username TEXT;

-- Case-insensitive uniqueness, but only among rows that actually have one —
-- accounts created before this migration simply don't support username
-- login until an admin (or the user themselves, via Profile) sets one.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;

WITH grouped AS (
  SELECT id,
         CASE
           WHEN role IN ('super_admin','admin') THEN 'Admin'
           WHEN role IN ('claims_officer','policy_admin','finance','client_relations') THEN 'Agent'
           ELSE 'User'
         END AS grp,
         ROW_NUMBER() OVER (
           PARTITION BY CASE
             WHEN role IN ('super_admin','admin') THEN 'Admin'
             WHEN role IN ('claims_officer','policy_admin','finance','client_relations') THEN 'Agent'
             ELSE 'User'
           END
           ORDER BY created_at, id
         ) AS n
  FROM public.profiles
  WHERE username IS NULL
)
UPDATE public.profiles p
SET username = g.grp || ' ' || g.n
FROM grouped g
WHERE p.id = g.id;

CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT email FROM public.profiles
  WHERE lower(username) = lower(trim(p_identifier)) AND active = true AND email IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(TEXT) TO anon, authenticated;
