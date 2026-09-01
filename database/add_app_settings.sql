-- Shared, DB-backed settings (previously localStorage, so each staff
-- member's browser had its own independent copy — e.g. a Super Admin
-- setting the insurer contact email on their machine had zero effect on
-- what a different staff member's browser used when it sent a reminder).
-- Only super_admin/admin can write; all staff can read.

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
