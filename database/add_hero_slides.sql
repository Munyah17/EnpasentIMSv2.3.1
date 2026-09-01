-- Public-website hero slider content, managed from Settings -> Website
-- Content (Super Admin/Admin) instead of being hardcoded in the
-- motions-website repo. Read publicly (service role, no RLS bypass risk --
-- see motions-website/api/hero-slides.ts) by the marketing site's home page.

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
DROP POLICY IF EXISTS "hero_slides_select_staff" ON public.hero_slides;
CREATE POLICY "hero_slides_select_staff" ON public.hero_slides FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "hero_slides_write_admin" ON public.hero_slides;
CREATE POLICY "hero_slides_write_admin" ON public.hero_slides FOR ALL TO authenticated USING (is_admin()) WITH CHECK (is_admin());

INSERT INTO public.hero_slides (icon, headline, sort_order) VALUES
  ('🛡', 'Real Protection for Real Life', 1),
  ('🌾', E'Cover Built for Zimbabwe''s Growers', 2),
  ('🏥', 'Health Cover That Pays When It Matters', 3),
  ('👨‍👩‍👧‍👦', 'Protect the Ones Who Depend on You', 4),
  ('🚗', 'Comprehensive Motor Cover', 5)
ON CONFLICT DO NOTHING;
