-- Insurer partner management — previously "insurer" was just a free-text
-- column on clients/policies backed by an identical hardcoded array
-- duplicated across four modals (EditClientModal, EditPolicyModal,
-- NewPolicyModal, RegisterClientModal). This gives Admin/Super Admin an
-- actual place to manage the partners themselves (contact info, status,
-- commission override, notes) instead of only ever typing a name.

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

DROP POLICY IF EXISTS "insurers_select_staff" ON public.insurers;
CREATE POLICY "insurers_select_staff" ON public.insurers FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "insurers_write_admin" ON public.insurers;
CREATE POLICY "insurers_write_admin" ON public.insurers FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

-- Seed with the insurers that were previously hardcoded, so nothing
-- selectable in existing client/policy records disappears.
INSERT INTO public.insurers (name, status) VALUES
  ('Motions', 'active'), ('CBZ Life', 'active'), ('EcoSure', 'active'),
  ('ZB Life', 'active'), ('Nyaradzo Funeral', 'active'), ('Doves', 'active')
ON CONFLICT (name) DO NOTHING;
