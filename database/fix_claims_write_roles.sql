-- Claims could only be written by super_admin, admin and claims_officer,
-- but the claims pipeline hands work to whoever is assigned at each stage,
-- and the staff list includes policy_admin, client_relations, finance and
-- tech_support. For those users every claim update was silently rejected by
-- RLS, fell back to browser storage, and produced the contradictory pair of
-- messages "Claim updated" and "saved locally only and has NOT synced".
--
-- Agents are deliberately still excluded: they submit claims and watch their
-- own book, they do not adjudicate. Policyholders and API partners likewise.
-- The application's own permission checks remain the finer-grained gate;
-- this policy is the backstop that has to agree with them.

DROP POLICY IF EXISTS claims_write ON public.claims;
CREATE POLICY claims_write ON public.claims
  FOR ALL TO authenticated
  USING (public.current_user_role() = ANY (ARRAY[
    'super_admin', 'admin', 'tech_support', 'claims_officer',
    'policy_admin', 'client_relations', 'finance'
  ]))
  WITH CHECK (public.current_user_role() = ANY (ARRAY[
    'super_admin', 'admin', 'tech_support', 'claims_officer',
    'policy_admin', 'client_relations', 'finance'
  ]));
