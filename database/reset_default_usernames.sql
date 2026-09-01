-- One-off fixup for a database that already ran an earlier version of
-- add_username_field.sql (back when it backfilled first-name usernames
-- instead of role-grouped ones). add_username_field.sql now backfills new
-- NULL usernames with this same "Admin 1 / Agent 1 / User 1" scheme
-- directly, so this file only matters for renumbering accounts that were
-- already backfilled under the old scheme. Every username stays editable
-- afterwards from Profile (self-service) or Staff management (admin).
--
-- Grouping: super_admin/admin -> "Admin N"; the operational staff roles
-- that work policies/claims (claims_officer, policy_admin, finance,
-- client_relations) -> "Agent N"; policyholder -> "User N". Numbered in
-- created_at order within each group for a stable, reproducible result.
--
-- Run this once in the Supabase SQL Editor against the live database.
-- Safe to re-run: it renumbers ALL profiles every time, so running it twice
-- in a row is a no-op (same order in, same numbers out).

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
)
UPDATE public.profiles p
SET username = g.grp || ' ' || g.n
FROM grouped g
WHERE p.id = g.id;
