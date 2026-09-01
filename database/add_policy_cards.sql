-- Membership cards (virtual + physical RFID) for everyone on a policy.
--
-- A dependant has no policy number of their own, so every person on a
-- policy is identified by a MEMBER NUMBER: the policy number, a dash, and
-- their two-digit position -- WEBFC12345678-00 is the policyholder,
-- -01 the first dependant, and so on. See src/lib/memberNumbers.ts.
--
-- The RFID tag is what the physical card transmits: a fixed unique number
-- and nothing else, exactly as a school or staff card works. It carries no
-- personal data; it resolves to a member here. A lost or suspended card
-- keeps its row precisely because the tag still exists in the world and a
-- reader has to be able to recognise it and refuse it.

CREATE TABLE IF NOT EXISTS public.policy_cards (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  member_number     TEXT NOT NULL UNIQUE,
  policy_id         UUID NOT NULL REFERENCES public.policies(id) ON DELETE CASCADE,
  policy_number     TEXT NOT NULL,
  member_position   INTEGER NOT NULL CHECK (member_position >= 0),
  member_name       TEXT NOT NULL,
  holder_name       TEXT NOT NULL,
  client_id         UUID REFERENCES public.clients(id) ON DELETE CASCADE,
  -- NULL until a physical card is encoded. Unique where set, so one tag can
  -- never resolve to two members.
  rfid_tag          TEXT UNIQUE,
  status            TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','lost','replaced')),
  issued_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- References profiles, not auth.users: PostgREST resolves the
  -- `profiles!issued_by(name)` embed in src/lib/db.ts through this foreign
  -- key, and every other staff reference in the schema is wired the same
  -- way (claim_assessments.assessor_id, fraud_signal_rules.created_by).
  issued_by         UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  expires_at        DATE,
  notes             TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Reader lookups hit the tag; the counter looks up the member number.
CREATE INDEX IF NOT EXISTS policy_cards_rfid_tag_idx ON public.policy_cards (rfid_tag) WHERE rfid_tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS policy_cards_policy_id_idx ON public.policy_cards (policy_id);
CREATE INDEX IF NOT EXISTS policy_cards_client_id_idx ON public.policy_cards (client_id);

ALTER TABLE public.policy_cards ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "policy_cards_select_staff" ON public.policy_cards;
CREATE POLICY "policy_cards_select_staff" ON public.policy_cards
  FOR SELECT TO authenticated USING (is_staff());

DROP POLICY IF EXISTS "policy_cards_insert_staff" ON public.policy_cards;
CREATE POLICY "policy_cards_insert_staff" ON public.policy_cards
  FOR INSERT TO authenticated WITH CHECK (is_staff());

DROP POLICY IF EXISTS "policy_cards_update_staff" ON public.policy_cards;
CREATE POLICY "policy_cards_update_staff" ON public.policy_cards
  FOR UPDATE TO authenticated USING (is_staff()) WITH CHECK (is_staff());

-- Cards are never deleted, only re-statused: a deleted row would leave a
-- live tag in circulation that resolves to nothing instead of to a refusal.
DROP POLICY IF EXISTS "policy_cards_delete_staff" ON public.policy_cards;

-- A policyholder may see the cards on their own policies (the portal shows
-- them their household's member numbers), using the same current_user_email()
-- rule as policies_select_own rather than reaching into auth.users directly.
DROP POLICY IF EXISTS "policy_cards_select_own" ON public.policy_cards;
CREATE POLICY "policy_cards_select_own" ON public.policy_cards
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.clients c
      WHERE c.id = policy_cards.client_id
        AND c.email = current_user_email()
    )
  );
