-- Live Chat Support: public pre-chat form (topic + name + phone + email) ->
-- queued session -> staff claims it -> real-time two-way chat.
--
-- Visitors are NOT required to have an account. They get a real (if
-- anonymous) Supabase Auth identity via supabase.auth.signInAnonymously(),
-- which gives us a genuine auth.uid() to scope RLS by — this is what makes
-- "only this visitor can read their own session" actually enforceable,
-- rather than relying on an unguessable-URL trust model.
--
-- Run this once in the Supabase SQL Editor against the live database.

CREATE TABLE IF NOT EXISTS public.chat_topics (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.chat_sessions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  visitor_id     UUID NOT NULL,
  visitor_name   TEXT NOT NULL,
  visitor_phone  TEXT NOT NULL,
  visitor_email  TEXT NOT NULL,
  topic          TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','active','closed')),
  assigned_to    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  queued_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at     TIMESTAMPTZ,
  closed_at      TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.chat_messages (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id  UUID NOT NULL REFERENCES public.chat_sessions(id) ON DELETE CASCADE,
  sender_type TEXT NOT NULL CHECK (sender_type IN ('visitor','agent','system')),
  sender_name TEXT NOT NULL,
  body        TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_session ON public.chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_status ON public.chat_sessions(status, queued_at);

ALTER TABLE public.chat_topics ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;

-- Topics: anyone (even anon, pre-chat form) can read active topics.
DROP POLICY IF EXISTS "chat_topics_select" ON public.chat_topics;
CREATE POLICY "chat_topics_select" ON public.chat_topics FOR SELECT TO anon, authenticated USING (active = true);
DROP POLICY IF EXISTS "chat_topics_write_admin" ON public.chat_topics;
CREATE POLICY "chat_topics_write_admin" ON public.chat_topics FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Sessions: a visitor can create/read/update only their own row (matched by
-- their anonymous auth uid); staff can read/update any (to run the queue).
DROP POLICY IF EXISTS "chat_sessions_insert" ON public.chat_sessions;
CREATE POLICY "chat_sessions_insert" ON public.chat_sessions FOR INSERT TO authenticated WITH CHECK (visitor_id = auth.uid());
DROP POLICY IF EXISTS "chat_sessions_select_own" ON public.chat_sessions;
CREATE POLICY "chat_sessions_select_own" ON public.chat_sessions FOR SELECT TO authenticated USING (visitor_id = auth.uid());
DROP POLICY IF EXISTS "chat_sessions_select_staff" ON public.chat_sessions;
CREATE POLICY "chat_sessions_select_staff" ON public.chat_sessions FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "chat_sessions_update_staff" ON public.chat_sessions;
CREATE POLICY "chat_sessions_update_staff" ON public.chat_sessions FOR UPDATE TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "chat_sessions_update_own_close" ON public.chat_sessions;
CREATE POLICY "chat_sessions_update_own_close" ON public.chat_sessions FOR UPDATE TO authenticated USING (visitor_id = auth.uid());

-- Messages: visitor can read/send within their own session; staff can
-- read/send within any session (needed to triage/claim from the queue).
DROP POLICY IF EXISTS "chat_messages_select_own" ON public.chat_messages;
CREATE POLICY "chat_messages_select_own" ON public.chat_messages FOR SELECT TO authenticated USING (
  EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = session_id AND s.visitor_id = auth.uid())
);
DROP POLICY IF EXISTS "chat_messages_select_staff" ON public.chat_messages;
CREATE POLICY "chat_messages_select_staff" ON public.chat_messages FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "chat_messages_insert_own" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_own" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (
  sender_type IN ('visitor', 'system') AND EXISTS (SELECT 1 FROM public.chat_sessions s WHERE s.id = session_id AND s.visitor_id = auth.uid())
);
DROP POLICY IF EXISTS "chat_messages_insert_staff" ON public.chat_messages;
CREATE POLICY "chat_messages_insert_staff" ON public.chat_messages FOR INSERT TO authenticated WITH CHECK (
  sender_type = 'agent' AND is_staff()
);

-- How many sessions are ahead of this one in the queue (1-indexed position).
-- SECURITY DEFINER so a visitor can know their queue position without RLS
-- exposing other visitors' session rows to them.
CREATE OR REPLACE FUNCTION public.get_chat_queue_position(p_session_id UUID)
RETURNS INT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*)::INT + 1 FROM public.chat_sessions
  WHERE status = 'queued'
    AND queued_at < (SELECT queued_at FROM public.chat_sessions WHERE id = p_session_id)
$$;

-- Realtime: push new messages and session status changes to subscribers.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_sessions') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_sessions;
  END IF;
END $$;

INSERT INTO public.chat_topics (name, sort_order) VALUES
  ('Buy a New Policy', 1),
  ('Existing Policy Question', 2),
  ('File or Track a Claim', 3),
  ('Billing & Payments', 4),
  ('Technical Support', 5),
  ('General Inquiry', 6)
ON CONFLICT DO NOTHING;
