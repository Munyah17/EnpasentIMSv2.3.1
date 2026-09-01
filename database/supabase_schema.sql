-- ================================================================
-- ENPASSENT IMS — Supabase Schema + Seed
-- Run this entire file in your Supabase SQL Editor
-- Reference copy: database/rebuild_database.sql is the canonical rebuild
-- script (see REBUILD_INSTRUCTIONS.md); this file is kept to match it.
-- ================================================================

-- ----------------------------------------------------------------
-- 1. EXTENSIONS
-- ----------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ----------------------------------------------------------------
-- 2. TABLES
-- ----------------------------------------------------------------

-- Profiles (extends auth.users — one row per authenticated user)
CREATE TABLE IF NOT EXISTS public.profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  username    TEXT,
  email       TEXT,
  role        TEXT NOT NULL DEFAULT 'policy_admin'
                CHECK (role IN ('super_admin','admin','tech_support','claims_officer','policy_admin','finance','client_relations','agent','policyholder','api_partner')),
  department  TEXT NOT NULL DEFAULT 'Administration',
  phone       TEXT,
  active      BOOLEAN NOT NULL DEFAULT TRUE,
  permissions TEXT[] NOT NULL DEFAULT '{}',
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Custom roles — Super Admin-defined, named permission bundles (see
-- src/lib/permissions.ts) assignable to a staff member on top of their base
-- system role. Staff/client deletion are never part of this catalog and
-- stay hard-gated to role = 'super_admin', so no custom role can grant them.
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

-- Clients (insured persons / policyholders)
CREATE TABLE IF NOT EXISTS public.clients (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  email       TEXT,
  phone       TEXT NOT NULL,
  national_id TEXT NOT NULL UNIQUE,
  dob         DATE,
  address     TEXT,
  occupation  TEXT,
  insurer     TEXT,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Products (insurance products)
CREATE TABLE IF NOT EXISTS public.products (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                TEXT NOT NULL,
  code                TEXT NOT NULL UNIQUE,
  category            TEXT NOT NULL CHECK (category IN ('life','funeral','health','accident','motor','property','agriculture')),
  premium             NUMERIC(10,2) NOT NULL,
  cover_amount        NUMERIC(14,2) NOT NULL,
  waiting_period_days INT NOT NULL DEFAULT 30,
  min_age             INT NOT NULL DEFAULT 18,
  max_age             INT NOT NULL DEFAULT 70,
  commission_pct      NUMERIC(5,2) NOT NULL DEFAULT 15,
  active              BOOLEAN NOT NULL DEFAULT TRUE,
  features            TEXT[] NOT NULL DEFAULT '{}',
  description         TEXT,
  excess              TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Policies
CREATE TABLE IF NOT EXISTS public.policies (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_number     TEXT NOT NULL UNIQUE,
  client_id         UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  product_id        UUID NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  premium           NUMERIC(10,2) NOT NULL,
  cover_amount      NUMERIC(14,2) NOT NULL,
  start_date        DATE NOT NULL,
  end_date          DATE NOT NULL,
  status            TEXT NOT NULL DEFAULT 'active'
                      CHECK (status IN ('active','waiting_period','lapsed','cancelled','pending','expired')),
  dependants        JSONB NOT NULL DEFAULT '[]',
  payment_method    TEXT NOT NULL,
  documents         TEXT[] NOT NULL DEFAULT '{}',
  insurer           TEXT,
  grower_number     TEXT,
  agent_id          UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  next_payment_date DATE,
  last_payment_date DATE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Claims
CREATE TABLE IF NOT EXISTS public.claims (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_number   TEXT NOT NULL UNIQUE,
  policy_id      UUID NOT NULL REFERENCES public.policies(id) ON DELETE RESTRICT,
  claim_type     TEXT NOT NULL,
  amount         NUMERIC(14,2) NOT NULL CHECK (amount > 0),
  status         TEXT NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','under_review','approved','rejected','paid')),
  -- Pipeline stage: intake (Claims Receiver) -> assessment (Claims Processor)
  -- -> final_review (MD/COO) -> closed. Separate from `status` (the outcome)
  -- so the UI knows who needs to act next.
  stage          TEXT NOT NULL DEFAULT 'intake'
                   CHECK (stage IN ('intake','assessment','final_review','closed')),
  assessment_notes TEXT,
  agent_id       UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  date_of_event  DATE NOT NULL,
  date_submitted DATE NOT NULL DEFAULT CURRENT_DATE,
  description    TEXT,
  fraud_score    INT NOT NULL DEFAULT 0 CHECK (fraud_score BETWEEN 0 AND 100),
  assigned_to    UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  documents      TEXT[] NOT NULL DEFAULT '{}',
  notes          TEXT,
  resolved_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Payments
CREATE TABLE IF NOT EXISTS public.payments (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference      TEXT NOT NULL UNIQUE,
  policy_id      UUID NOT NULL REFERENCES public.policies(id) ON DELETE RESTRICT,
  amount         NUMERIC(10,2) NOT NULL CHECK (amount > 0),
  method         TEXT NOT NULL CHECK (method IN ('EcoCash','OneMoney','InnBucks','Bank Transfer','Cash','Debit Order','Stop Order','Paynow','Zipit')),
  status         TEXT NOT NULL DEFAULT 'completed'
                   CHECK (status IN ('completed','pending','failed','reversed')),
  payment_date   DATE NOT NULL DEFAULT CURRENT_DATE,
  split_payments JSONB,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tickets
CREATE TABLE IF NOT EXISTS public.tickets (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  ticket_number TEXT NOT NULL UNIQUE,
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE RESTRICT,
  subject       TEXT NOT NULL,
  description   TEXT,
  status        TEXT NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open','in_progress','resolved','closed')),
  priority      TEXT NOT NULL DEFAULT 'medium'
                  CHECK (priority IN ('low','medium','high','urgent')),
  category      TEXT NOT NULL DEFAULT 'General',
  assigned_to   UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  messages      JSONB NOT NULL DEFAULT '[]',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Emails (bi-directional email store)
CREATE TABLE IF NOT EXISTS public.emails (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  from_address TEXT NOT NULL,
  from_name    TEXT,
  to_address   TEXT NOT NULL,
  subject      TEXT NOT NULL,
  body         TEXT,
  read         BOOLEAN NOT NULL DEFAULT FALSE,
  folder       TEXT NOT NULL DEFAULT 'inbox' CHECK (folder IN ('inbox','sent','draft')),
  linked_to    TEXT,
  attachments  TEXT[] NOT NULL DEFAULT '{}',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Leads
CREATE TABLE IF NOT EXISTS public.leads (
  id               UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name             TEXT NOT NULL,
  email            TEXT,
  phone            TEXT NOT NULL,
  source           TEXT,
  product_interest TEXT,
  status           TEXT NOT NULL DEFAULT 'new'
                     CHECK (status IN ('new','contacted','qualified','proposal','converted','lost')),
  intent_score     INT NOT NULL DEFAULT 50 CHECK (intent_score BETWEEN 0 AND 100),
  assigned_to      UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_contact     DATE,
  notes            TEXT,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Fraud Cases
CREATE TABLE IF NOT EXISTS public.fraud_cases (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id    UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  fraud_score INT NOT NULL CHECK (fraud_score BETWEEN 0 AND 100),
  signals     TEXT[] NOT NULL DEFAULT '{}',
  status      TEXT NOT NULL DEFAULT 'open'
                CHECK (status IN ('open','investigating','confirmed','cleared')),
  assigned_to UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  notes       TEXT,
  resolved_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reminders
CREATE TABLE IF NOT EXISTS public.reminders (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  type          TEXT NOT NULL
                  CHECK (type IN ('payment_due','policy_renewal','claim_followup','birthday','document_expiry')),
  client_id     UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  policy_id     UUID REFERENCES public.policies(id) ON DELETE CASCADE,
  due_date      DATE NOT NULL,
  message       TEXT,
  sent          BOOLEAN NOT NULL DEFAULT FALSE,
  channel       TEXT NOT NULL CHECK (channel IN ('sms','whatsapp','email','ussd')),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ----------------------------------------------------------------
-- 3. INDEXES (for common queries)
-- ----------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_policies_client    ON public.policies(client_id);
CREATE INDEX IF NOT EXISTS idx_policies_status    ON public.policies(status);
CREATE INDEX IF NOT EXISTS idx_claims_policy      ON public.claims(policy_id);
CREATE INDEX IF NOT EXISTS idx_claims_status      ON public.claims(status);
CREATE INDEX IF NOT EXISTS idx_payments_policy    ON public.payments(policy_id);
CREATE INDEX IF NOT EXISTS idx_payments_date      ON public.payments(payment_date);
CREATE INDEX IF NOT EXISTS idx_leads_status       ON public.leads(status);
CREATE INDEX IF NOT EXISTS idx_tickets_status     ON public.tickets(status);
CREATE INDEX IF NOT EXISTS idx_fraud_cases_claim  ON public.fraud_cases(claim_id);
CREATE INDEX IF NOT EXISTS idx_policies_agent     ON public.policies(agent_id);
CREATE INDEX IF NOT EXISTS idx_claims_assigned    ON public.claims(assigned_to);
CREATE INDEX IF NOT EXISTS idx_leads_assigned     ON public.leads(assigned_to);
CREATE INDEX IF NOT EXISTS idx_tickets_client     ON public.tickets(client_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role      ON public.profiles(role);
CREATE INDEX IF NOT EXISTS idx_profiles_active    ON public.profiles(active);
-- Case-insensitive uniqueness, only among rows that have a username set.
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_unique
  ON public.profiles (lower(username)) WHERE username IS NOT NULL;

-- ----------------------------------------------------------------
-- 4. TRIGGERS — auto-create profile + auto-update timestamps
-- ----------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  -- Anonymous sign-ins (live chat visitors) have no email and don't need a
  -- staff/policyholder profile row.
  IF NEW.is_anonymous THEN
    RETURN NEW;
  END IF;
  INSERT INTO public.profiles (id, name, role, department, email)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'name', split_part(NEW.email, '@', 1)),
    COALESCE(NEW.raw_user_meta_data->>'role', 'policy_admin'),
    COALESCE(NEW.raw_user_meta_data->>'department', 'Administration'),
    NEW.email
  )
  ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Keep profiles.email in sync if the auth email changes later.
CREATE OR REPLACE FUNCTION public.sync_profile_email()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles SET email = NEW.email WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.sync_profile_email();

-- Auto-update updated_at columns
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER clients_updated_at BEFORE UPDATE ON public.clients
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER policies_updated_at BEFORE UPDATE ON public.policies
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();
CREATE TRIGGER tickets_updated_at BEFORE UPDATE ON public.tickets
  FOR EACH ROW EXECUTE PROCEDURE public.set_updated_at();

-- ----------------------------------------------------------------
-- 5. ROW LEVEL SECURITY (v2 — improved for robustness)
-- ----------------------------------------------------------------
ALTER TABLE public.profiles    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.clients     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policies    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.claims      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.payments    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tickets     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.emails      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leads       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_cases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reminders   ENABLE ROW LEVEL SECURITY;

-- Force RLS even for table owners
ALTER TABLE public.profiles    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.clients     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.products    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.policies    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.claims      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.payments    FORCE ROW LEVEL SECURITY;
ALTER TABLE public.tickets     FORCE ROW LEVEL SECURITY;
ALTER TABLE public.emails      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.leads       FORCE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_cases FORCE ROW LEVEL SECURITY;
ALTER TABLE public.reminders   FORCE ROW LEVEL SECURITY;

-- Helper: get current user's role (safe default — never NULL)
CREATE OR REPLACE FUNCTION public.current_user_role()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(role, '') FROM public.profiles WHERE id = auth.uid()
$$;

-- Helper: is current user a staff member? (returns FALSE if no profile)
CREATE OR REPLACE FUNCTION public.is_staff()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role IN ('super_admin','admin','tech_support','claims_officer','policy_admin','finance','client_relations','agent')
     FROM public.profiles WHERE id = auth.uid()),
    FALSE
  )
$$;

-- System roles (super_admin, admin, tech_support) can only be changed by a
-- Super Admin, regardless of which endpoint the update comes through — see
-- src/pages/SystemAccessRoles.tsx.
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

-- Helper: is current user an admin?
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COALESCE(
    (SELECT role IN ('super_admin','admin')
     FROM public.profiles WHERE id = auth.uid()),
    FALSE
  )
$$;

-- Current user's auth email. SECURITY DEFINER so RLS policies can compare
-- against it without needing a direct grant on auth.users (the
-- `authenticated` role has none — a plain policy querying auth.users
-- directly breaks every query that touches the policy's table).
CREATE OR REPLACE FUNCTION public.current_user_email()
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT email FROM auth.users WHERE id = auth.uid()
$$;

-- Resolves a username to its email for username-based login (there's no
-- session yet at this point in the login flow, so profiles_select's
-- `authenticated`-only grant can't be used directly). Only ever returns a
-- bare email — see database/add_username_field.sql for the full rationale.
CREATE OR REPLACE FUNCTION public.resolve_login_email(p_identifier TEXT)
RETURNS TEXT LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT email FROM public.profiles
  WHERE lower(username) = lower(trim(p_identifier)) AND active = true AND email IS NOT NULL
  LIMIT 1
$$;

REVOKE ALL ON FUNCTION public.resolve_login_email(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_login_email(TEXT) TO anon, authenticated;

-- Helper: does current user own a specific policy?
CREATE OR REPLACE FUNCTION public.owns_policy(check_policy_id UUID)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.policies p
    JOIN public.clients c ON c.id = p.client_id
    WHERE p.id = check_policy_id
      AND c.email = (SELECT email FROM auth.users WHERE id = auth.uid())
  )
$$;

-- Profiles
CREATE POLICY "profiles_select" ON public.profiles FOR SELECT TO authenticated USING (true);
CREATE POLICY "profiles_update_own" ON public.profiles FOR UPDATE TO authenticated USING (id = auth.uid());
CREATE POLICY "profiles_update_admin" ON public.profiles FOR UPDATE TO authenticated USING (is_admin());
CREATE POLICY "profiles_delete_super" ON public.profiles FOR DELETE TO authenticated USING (current_user_role() = 'super_admin');
CREATE POLICY "profiles_insert_trigger" ON public.profiles FOR INSERT TO authenticated WITH CHECK (true);

-- Custom roles
ALTER TABLE public.custom_roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "custom_roles_select_staff" ON public.custom_roles FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "custom_roles_write_super_admin" ON public.custom_roles FOR ALL TO authenticated
  USING (current_user_role() = 'super_admin')
  WITH CHECK (current_user_role() = 'super_admin');

-- RLS only filters which ROWS a policy applies to, not which columns —
-- without this trigger, profiles_update_own would let any user change their
-- own role/active/permissions/department (privilege escalation). Self-edits
-- keep those fields locked; only an admin editing SOMEONE ELSE's row
-- (matched by profiles_update_admin) can change them.
CREATE OR REPLACE FUNCTION public.lock_privileged_profile_fields_on_self_update()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF auth.uid() = OLD.id THEN
    NEW.role           := OLD.role;
    NEW.active          := OLD.active;
    NEW.permissions     := OLD.permissions;
    NEW.department      := OLD.department;
    NEW.custom_role_id  := OLD.custom_role_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_lock_privileged_profile_fields ON public.profiles;
CREATE TRIGGER trg_lock_privileged_profile_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.lock_privileged_profile_fields_on_self_update();

DROP TRIGGER IF EXISTS trg_block_non_super_admin_system_role_changes ON public.profiles;
CREATE TRIGGER trg_block_non_super_admin_system_role_changes
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.block_non_super_admin_system_role_changes();

-- Clients
CREATE POLICY "clients_select_staff" ON public.clients FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "clients_select_own" ON public.clients FOR SELECT TO authenticated USING (
  email = public.current_user_email()
);
CREATE POLICY "clients_insert" ON public.clients FOR INSERT TO authenticated WITH CHECK (is_staff());
CREATE POLICY "clients_update" ON public.clients FOR UPDATE TO authenticated USING (is_staff());
CREATE POLICY "clients_delete_super_admin" ON public.clients FOR DELETE TO authenticated USING (current_user_role() = 'super_admin');

-- Products
CREATE POLICY "products_select" ON public.products FOR SELECT TO authenticated USING (true);
CREATE POLICY "products_write" ON public.products FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());

-- Policies
CREATE POLICY "policies_select_staff" ON public.policies FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "policies_select_own" ON public.policies FOR SELECT TO authenticated USING (
  EXISTS (
    SELECT 1 FROM public.clients c
    WHERE c.id = client_id
      AND c.email = public.current_user_email()
  )
);
CREATE POLICY "policies_write" ON public.policies FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "policies_delete_admin" ON public.policies FOR DELETE TO authenticated USING (is_admin());

-- Claims
CREATE POLICY "claims_select_staff" ON public.claims FOR SELECT TO authenticated USING (is_staff());
-- Policyholders can read their own claims -- see add_claims_payments_select_own.sql.
CREATE POLICY "claims_select_own" ON public.claims FOR SELECT TO authenticated USING (public.owns_policy(policy_id));
CREATE POLICY "claims_write" ON public.claims FOR ALL TO authenticated
  USING (current_user_role() IN ('super_admin','admin','claims_officer'))
  WITH CHECK (current_user_role() IN ('super_admin','admin','claims_officer'));
CREATE POLICY "claims_delete_admin" ON public.claims FOR DELETE TO authenticated USING (is_admin());

-- Payments
CREATE POLICY "payments_select_staff" ON public.payments FOR SELECT TO authenticated USING (is_staff());
-- Policyholders can read their own payments -- same gap, same fix as claims above.
CREATE POLICY "payments_select_own" ON public.payments FOR SELECT TO authenticated USING (public.owns_policy(policy_id));
CREATE POLICY "payments_write" ON public.payments FOR ALL TO authenticated
  USING (current_user_role() IN ('super_admin','admin','finance'))
  WITH CHECK (current_user_role() IN ('super_admin','admin','finance'));
CREATE POLICY "payments_delete_admin" ON public.payments FOR DELETE TO authenticated USING (is_admin());

-- Tickets
CREATE POLICY "tickets_select" ON public.tickets FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "tickets_write" ON public.tickets FOR ALL TO authenticated
  USING (current_user_role() IN ('super_admin','admin','client_relations'))
  WITH CHECK (current_user_role() IN ('super_admin','admin','client_relations'));
CREATE POLICY "tickets_delete_admin" ON public.tickets FOR DELETE TO authenticated USING (is_admin());

-- Emails
CREATE POLICY "emails_select" ON public.emails FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "emails_write" ON public.emails FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "emails_delete" ON public.emails FOR DELETE TO authenticated USING (is_staff());

-- Leads
CREATE POLICY "leads_select" ON public.leads FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "leads_write" ON public.leads FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "leads_delete" ON public.leads FOR DELETE TO authenticated USING (is_staff());

-- Fraud Cases
CREATE POLICY "fraud_select" ON public.fraud_cases FOR SELECT TO authenticated
  USING (current_user_role() IN ('super_admin','admin','claims_officer'));
CREATE POLICY "fraud_write" ON public.fraud_cases FOR ALL TO authenticated
  USING (current_user_role() IN ('super_admin','admin','claims_officer'))
  WITH CHECK (current_user_role() IN ('super_admin','admin','claims_officer'));
CREATE POLICY "fraud_delete" ON public.fraud_cases FOR DELETE TO authenticated USING (is_admin());

-- Reminders
CREATE POLICY "reminders_select" ON public.reminders FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "reminders_write" ON public.reminders FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "reminders_delete" ON public.reminders FOR DELETE TO authenticated USING (is_staff());

-- ================================================================
-- 6. STAFF ACCOUNTS
-- ================================================================
--
-- Create the bootstrap Super Admin through Supabase's Auth Admin API, not
-- a raw INSERT into auth.users -- see the matching comment in
-- database/rebuild_database.sql (section 9a) for the exact curl command,
-- why the API is the officially supported path, and the permissions=
-- ARRAY['all'] follow-up UPDATE it also needs. Every further staff account
-- is created from inside the app's own Staff page by that Super Admin,
-- with the app's own password rules -- not seeded here with a shared
-- password anyone with git access to this file could read.
-- ================================================================

-- ----------------------------------------------------------------
-- LIVE CHAT (see database/add_live_chat.sql for the standalone migration)
-- ----------------------------------------------------------------
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

-- ================================================================
-- Caution Flags (moved from client-side localStorage to a real table
-- so a flag raised by one staff member's reminder-check run is visible
-- to every staff member, including whoever reviews claims)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.caution_flags (
  policy_id        UUID PRIMARY KEY REFERENCES public.policies(id) ON DELETE CASCADE,
  policy_number    TEXT NOT NULL,
  client_id        UUID NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  client_name      TEXT NOT NULL,
  agent_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  days_overdue     INTEGER NOT NULL DEFAULT 0,
  flagged_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  months_defaulted INTEGER NOT NULL DEFAULT 1,
  cleared          BOOLEAN NOT NULL DEFAULT FALSE,
  cleared_at       TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_caution_flags_cleared ON public.caution_flags(cleared);

ALTER TABLE public.caution_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.caution_flags FORCE ROW LEVEL SECURITY;

CREATE POLICY "caution_flags_select" ON public.caution_flags FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "caution_flags_write"  ON public.caution_flags FOR ALL    TO authenticated USING (is_staff()) WITH CHECK (is_staff());

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'caution_flags') THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.caution_flags;
  END IF;
END $$;
ALTER TABLE public.caution_flags REPLICA IDENTITY FULL;

-- ================================================================
-- App Settings (previously localStorage — each staff browser had its own
-- independent copy of notification/gateway config with no shared source
-- of truth and no write restriction to Super Admin)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT PRIMARY KEY,
  value       JSONB NOT NULL,
  updated_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings FORCE ROW LEVEL SECURITY;

CREATE POLICY "app_settings_select" ON public.app_settings FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "app_settings_write"  ON public.app_settings FOR ALL    TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- ================================================================
-- Login Attempts (real brute-force detection for System Health)
-- ================================================================
CREATE TABLE IF NOT EXISTS public.login_attempts (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  email      TEXT NOT NULL,
  success    BOOLEAN NOT NULL,
  ts         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_attempts_ts ON public.login_attempts(ts DESC);
CREATE INDEX IF NOT EXISTS idx_login_attempts_email ON public.login_attempts(email);

ALTER TABLE public.login_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_attempts FORCE ROW LEVEL SECURITY;

CREATE POLICY "login_attempts_insert_anon" ON public.login_attempts FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "login_attempts_insert_auth" ON public.login_attempts FOR INSERT TO authenticated WITH CHECK (true);
CREATE POLICY "login_attempts_select_staff" ON public.login_attempts FOR SELECT TO authenticated USING (is_staff());

CREATE OR REPLACE FUNCTION public.trim_login_attempts()
RETURNS VOID LANGUAGE sql SECURITY DEFINER AS $$
  DELETE FROM public.login_attempts WHERE ts < NOW() - INTERVAL '7 days'
$$;

-- Locks sign-in after 5 consecutive failures for one email (broken by any
-- success in between). See database/add_login_lockout.sql for the full
-- rationale -- unlocking is a human clearing login_attempts, not a timer.
CREATE OR REPLACE FUNCTION public.is_login_locked(p_email TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER AS $$
  SELECT COUNT(*) = 5 FROM (
    SELECT success FROM public.login_attempts
    WHERE email = lower(trim(p_email))
    ORDER BY ts DESC
    LIMIT 5
  ) recent
  WHERE NOT success
$$;

REVOKE ALL ON FUNCTION public.is_login_locked(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_login_locked(TEXT) TO anon, authenticated;

-- Developer API platform: lets an external developer/app sell this
-- company's insurance products through their own product, via an API key.
-- A developer is represented internally by a real profiles row (role
-- 'api_partner') so policies.agent_id can point at it — this reuses the
-- existing agent/commission/reporting machinery unchanged instead of
-- building a parallel system. api_partner accounts are never given a
-- usable login; all traffic goes through the service-role-backed Netlify
-- function using their API key, never a Supabase session.
-- (role check constraint already includes 'api_partner' — see the
-- profiles table definition above; this used to be a second, incomplete
-- ALTER here that silently dropped 'tech_support' and 'agent' on a fresh
-- rebuild — see database/fix_profiles_role_check_missing_roles.sql.)

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
  -- Publishable half of the pair (mirrors Stripe's pk_/sk_ pattern) — safe
  -- to store/display in plain text, grants nothing on its own.
  publishable_key     TEXT,
  environment         TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('sandbox','live')),
  scopes              TEXT[] NOT NULL DEFAULT ARRAY['products:read','quotes:read','clients:write','policies:write','policies:read','payments:write'],
  status              TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','revoked')),
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

-- Agriculture Assessor claims workflow — see database/add_agriculture_assessments.sql
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS gps_lat NUMERIC(9,6);
ALTER TABLE public.policies ADD COLUMN IF NOT EXISTS gps_lng NUMERIC(9,6);
ALTER TABLE public.claims ADD COLUMN IF NOT EXISTS category TEXT;

CREATE TABLE IF NOT EXISTS public.claim_assessments (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  claim_id            UUID NOT NULL REFERENCES public.claims(id) ON DELETE CASCADE,
  assessor_id         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  description_of_loss TEXT,
  photos              JSONB NOT NULL DEFAULT '[]',
  assessor_comments   TEXT,
  farmer_statement    TEXT,
  gps_lat             NUMERIC(9,6),
  gps_lng             NUMERIC(9,6),
  crop_population     TEXT,
  crop_stage          TEXT,
  barn_capacity       TEXT,
  farmer_signature    TEXT,
  assessor_signature  TEXT,
  farmer_selfie       TEXT,
  submitted_at        TIMESTAMPTZ,
  sync_status         TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','pending_sync')),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.policy_assessments (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  policy_id             UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  assessor_id           UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  -- 'agriculture' (crop_*) or 'vehicle' (registration_number/vehicle_*/
  -- odometer_reading/existing_damage) — see database/add_vehicle_preloss_assessment.sql
  subject_type          TEXT NOT NULL DEFAULT 'agriculture' CHECK (subject_type IN ('agriculture','vehicle')),
  crop_type             TEXT,
  crop_population       TEXT,
  plant_date            DATE,
  registration_number   TEXT,
  vehicle_make          TEXT,
  vehicle_model         TEXT,
  odometer_reading      TEXT,
  existing_damage       TEXT,
  photos                JSONB NOT NULL DEFAULT '[]',
  notes                 TEXT,
  gps_lat               NUMERIC(9,6),
  gps_lng               NUMERIC(9,6),
  farmer_signature      TEXT,
  assessor_signature    TEXT,
  sync_status           TEXT NOT NULL DEFAULT 'synced' CHECK (sync_status IN ('synced','pending_sync')),
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.claim_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.policy_assessments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "claim_assessments_select_staff" ON public.claim_assessments FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "claim_assessments_write_staff" ON public.claim_assessments FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());
CREATE POLICY "policy_assessments_select_staff" ON public.policy_assessments FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "policy_assessments_write_staff" ON public.policy_assessments FOR ALL TO authenticated USING (is_staff()) WITH CHECK (is_staff());

-- Insurer partner management — see database/add_insurers.sql
CREATE TABLE IF NOT EXISTS public.insurers (
  id                    UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name                  TEXT NOT NULL UNIQUE,
  contact_email         TEXT,
  contact_phone         TEXT,
  address               TEXT,
  reg_number            TEXT,
  commission_percent    NUMERIC(5,2),
  status                TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  notes                 TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.insurers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurers FORCE ROW LEVEL SECURITY;
CREATE POLICY "insurers_select_staff" ON public.insurers FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "insurers_write_admin" ON public.insurers FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());
ALTER TABLE public.insurers ADD COLUMN IF NOT EXISTS cover_types TEXT[] NOT NULL DEFAULT '{}';

-- Perceptual-hash index for duplicate/reused photo detection — see database/add_photo_hashes.sql
CREATE TABLE IF NOT EXISTS public.photo_hashes (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  hash         TEXT NOT NULL,
  source_type  TEXT NOT NULL CHECK (source_type IN ('claim','policy')),
  source_id    UUID NOT NULL,
  reference    TEXT NOT NULL,
  label        TEXT NOT NULL,
  photo_path   TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_photo_hashes_hash ON public.photo_hashes(hash);
CREATE INDEX IF NOT EXISTS idx_photo_hashes_created ON public.photo_hashes(created_at DESC);
ALTER TABLE public.photo_hashes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.photo_hashes FORCE ROW LEVEL SECURITY;
CREATE POLICY "photo_hashes_select_staff" ON public.photo_hashes FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "photo_hashes_insert_staff" ON public.photo_hashes FOR INSERT TO authenticated WITH CHECK (is_staff());

-- Managed crop-type list — see database/add_crop_types.sql
CREATE TABLE IF NOT EXISTS public.crop_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.crop_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_types FORCE ROW LEVEL SECURITY;
CREATE POLICY "crop_types_select_staff" ON public.crop_types FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "crop_types_write_admin" ON public.crop_types FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Org-defined fraud red flags, fed into AI scoring — see database/add_fraud_signal_rules.sql
CREATE TABLE IF NOT EXISTS public.fraud_signal_rules (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  description TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_by  UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.fraud_signal_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.fraud_signal_rules FORCE ROW LEVEL SECURITY;
CREATE POLICY "fraud_signal_rules_select_staff" ON public.fraud_signal_rules FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "fraud_signal_rules_write_admin" ON public.fraud_signal_rules FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Public-website hero slider content — see database/add_hero_slides.sql
CREATE TABLE IF NOT EXISTS public.hero_slides (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  icon        TEXT NOT NULL,
  headline    TEXT,
  sort_order  INT NOT NULL DEFAULT 0,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.hero_slides ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.hero_slides FORCE ROW LEVEL SECURITY;
CREATE POLICY "hero_slides_select_staff" ON public.hero_slides FOR SELECT TO authenticated USING (is_staff());
CREATE POLICY "hero_slides_write_admin" ON public.hero_slides FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Public self-service checkout sessions — see database/add_checkout_sessions.sql
CREATE TABLE IF NOT EXISTS public.checkout_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  reference           TEXT NOT NULL UNIQUE,
  status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','failed','cancelled')),
  gateway             TEXT NOT NULL CHECK (gateway IN ('paynow','ecocash_instant')),
  payment_method      TEXT,
  gateway_poll_url    TEXT,
  gateway_txn_id      TEXT,
  amount              NUMERIC(10,2) NOT NULL,
  product_id          UUID NOT NULL REFERENCES public.products(id),
  client_name         TEXT NOT NULL,
  client_email        TEXT NOT NULL,
  client_phone        TEXT NOT NULL,
  client_national_id  TEXT NOT NULL,
  client_dob          DATE,
  client_address      TEXT,
  client_occupation   TEXT,
  dependants          JSONB NOT NULL DEFAULT '[]',
  policy_id           UUID REFERENCES public.policies(id),
  failure_reason      TEXT,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.checkout_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY "checkout_sessions_select_staff" ON public.checkout_sessions FOR SELECT TO authenticated USING (is_staff());
