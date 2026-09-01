-- Perceptual-hash index for duplicate/reused photo detection across claim
-- and policy assessments — see src/lib/photoHash.ts for the dHash
-- algorithm. One row per uploaded assessment photo; a new upload is
-- compared against this table (client-side Hamming distance, see
-- db.photoHashes.findMatches) to catch a recycled photo from an earlier
-- claim being resubmitted as "new" damage evidence.

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
DROP POLICY IF EXISTS "photo_hashes_select_staff" ON public.photo_hashes;
CREATE POLICY "photo_hashes_select_staff" ON public.photo_hashes FOR SELECT TO authenticated USING (is_staff());
DROP POLICY IF EXISTS "photo_hashes_insert_staff" ON public.photo_hashes;
CREATE POLICY "photo_hashes_insert_staff" ON public.photo_hashes FOR INSERT TO authenticated WITH CHECK (is_staff());
