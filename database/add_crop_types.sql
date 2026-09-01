-- Managed crop-type list for agriculture policies — previously "crop type"
-- was a free-text field typed fresh every time. Seeded with the two crops
-- actually written today (Tobacco, Cotton); Admin/Super Admin can add more
-- from the Agriculture Insurance hub page as the book expands.

CREATE TABLE IF NOT EXISTS public.crop_types (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL UNIQUE,
  status      TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE public.crop_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crop_types FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "crop_types_select_staff" ON public.crop_types;
CREATE POLICY "crop_types_select_staff" ON public.crop_types FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "crop_types_write_admin" ON public.crop_types;
CREATE POLICY "crop_types_write_admin" ON public.crop_types FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO public.crop_types (name) VALUES ('Tobacco'), ('Cotton') ON CONFLICT (name) DO NOTHING;
