-- Developer API platform: lets an external developer/app sell this
-- company's insurance products through their own product, via an API key.
-- A developer is represented internally by a real profiles row (role
-- 'api_partner') so policies.agent_id can point at it — this reuses the
-- existing agent/commission/reporting machinery unchanged instead of
-- building a parallel system. api_partner accounts are never given a
-- usable login; all traffic goes through the service-role-backed Netlify
-- function using their API key, never a Supabase session.

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('super_admin','admin','claims_officer','policy_admin','finance','client_relations','policyholder','api_partner'));

CREATE TABLE IF NOT EXISTS public.api_developers (
  id                           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_profile_id             UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  company_name                 TEXT NOT NULL,
  contact_email                TEXT NOT NULL,
  contact_phone                TEXT,
  status                       TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended')),
  commission_override_percent  NUMERIC,
  created_at                   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.api_keys (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  developer_id        UUID NOT NULL REFERENCES public.api_developers(id) ON DELETE CASCADE,
  key_prefix          TEXT NOT NULL,
  key_hash            TEXT NOT NULL UNIQUE,
  scopes              TEXT[] NOT NULL DEFAULT ARRAY['products:read','quotes:read','clients:write','policies:write','policies:read','payments:write'],
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  rate_limit_per_min  INT NOT NULL DEFAULT 60,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at        TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.api_request_log (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  key_id      UUID REFERENCES public.api_keys(id) ON DELETE CASCADE,
  endpoint    TEXT NOT NULL,
  status_code INT NOT NULL,
  ts          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_request_log_key_ts ON public.api_request_log(key_id, ts DESC);
CREATE INDEX IF NOT EXISTS idx_api_developers_agent ON public.api_developers(agent_profile_id);

ALTER TABLE public.api_developers  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_developers  FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_keys        FORCE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_request_log FORCE ROW LEVEL SECURITY;

-- Only admins manage developers/keys from the app UI. All actual external
-- API traffic goes through netlify/functions/api-v1.ts using the
-- service-role key, which bypasses RLS entirely and enforces isolation
-- in application code (every query is scoped to the caller's own
-- agent_profile_id).
CREATE POLICY "api_developers_admin" ON public.api_developers FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "api_keys_admin" ON public.api_keys FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
CREATE POLICY "api_request_log_admin_select" ON public.api_request_log FOR SELECT TO authenticated USING (is_admin());
