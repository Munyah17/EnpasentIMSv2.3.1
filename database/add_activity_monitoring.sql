-- Answering "what is being done with our keys and our privileges" needs two
-- records: what partners do through the API, and what staff do inside the
-- system. The first existed but was too thin to investigate anything; the
-- second did not exist at all.

-- ── API requests ──────────────────────────────────────────────────────
-- endpoint + status_code alone cannot tell you who called, from where, with
-- which verb, or whether it was slow. All four are what an investigation
-- actually starts from.
ALTER TABLE public.api_request_log ADD COLUMN IF NOT EXISTS method TEXT;
ALTER TABLE public.api_request_log ADD COLUMN IF NOT EXISTS ip TEXT;
ALTER TABLE public.api_request_log ADD COLUMN IF NOT EXISTS duration_ms INT;

CREATE INDEX IF NOT EXISTS api_request_log_ts_idx ON public.api_request_log (ts DESC);
CREATE INDEX IF NOT EXISTS api_request_log_key_ts_idx ON public.api_request_log (key_id, ts DESC);

-- ── Staff activity ────────────────────────────────────────────────────
-- Every privileged action, attributed to a person. Actor details are
-- denormalised on purpose: the point of an audit trail is that it still
-- reads correctly after the account is renamed, demoted or deleted.
CREATE TABLE IF NOT EXISTS public.activity_log (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_name   TEXT NOT NULL,
  actor_role   TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT,
  entity_id    TEXT,
  entity_label TEXT,
  detail       TEXT,
  severity     TEXT NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'notice', 'warning')),
  ts           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS activity_log_ts_idx ON public.activity_log (ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_actor_idx ON public.activity_log (actor_id, ts DESC);
CREATE INDEX IF NOT EXISTS activity_log_action_idx ON public.activity_log (action, ts DESC);

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

-- Anyone on staff may write their own trail; nobody may rewrite history.
-- There is deliberately no UPDATE or DELETE policy, so the log is
-- append-only even for an admin going through the API.
DROP POLICY IF EXISTS activity_log_insert ON public.activity_log;
CREATE POLICY activity_log_insert ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (public.is_staff());

-- Reading it is an oversight function, so it stays with the two roles that
-- own oversight.
DROP POLICY IF EXISTS activity_log_select ON public.activity_log;
CREATE POLICY activity_log_select ON public.activity_log
  FOR SELECT TO authenticated
  USING (public.current_user_role() = ANY (ARRAY['super_admin', 'admin']));
