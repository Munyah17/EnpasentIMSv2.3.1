-- Document upload: a private Storage bucket for claim/policy/communication
-- attachments, plus RLS on storage.objects so only staff (and the
-- policyholder who owns the file's folder) can read or write. Everything
-- uploaded goes in one bucket, namespaced by folder (claims/, policies/,
-- tickets/) then by the owning record's id, e.g.
-- "claims/<claim_id>/receipt.pdf" — that path is what gets stored in the
-- existing claims.documents / tickets.attachments TEXT[] columns (which
-- have been sitting unused since they were first added).
--
-- Run this once in the Supabase SQL Editor against the live database.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'documents', 'documents', false, 10485760, -- 10MB
  ARRAY[
    'application/pdf', 'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/rtf', 'text/rtf',
    'image/jpeg', 'image/png', 'image/webp'
  ]
)
ON CONFLICT (id) DO UPDATE SET
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Staff can read/write anything in the bucket (matches how every other
-- table in this app treats staff — full internal access, isolation is
-- only enforced against policyholders and API developers).
DROP POLICY IF EXISTS "documents_staff_all" ON storage.objects;
CREATE POLICY "documents_staff_all" ON storage.objects
  FOR ALL TO authenticated
  USING (bucket_id = 'documents' AND is_staff())
  WITH CHECK (bucket_id = 'documents' AND is_staff());

-- A policyholder may read/upload only within their OWN client's folder —
-- documents/policies/<their client id>/... or documents/claims/<a claim id
-- on one of their own policies>/... — checked against clients.email
-- matching the authenticated user's own email, the same identity link the
-- rest of the app already relies on (see current_user_email()).
DROP POLICY IF EXISTS "documents_policyholder_own" ON storage.objects;
CREATE POLICY "documents_policyholder_own" ON storage.objects
  FOR ALL TO authenticated
  USING (
    bucket_id = 'documents' AND NOT is_staff() AND (
      ((storage.foldername(name))[1] = 'policies' AND EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id::text = (storage.foldername(name))[2] AND c.email = public.current_user_email()
      ))
      OR
      ((storage.foldername(name))[1] = 'claims' AND EXISTS (
        SELECT 1 FROM public.claims cl
        JOIN public.policies p ON p.id = cl.policy_id
        JOIN public.clients c ON c.id = p.client_id
        WHERE cl.id::text = (storage.foldername(name))[2] AND c.email = public.current_user_email()
      ))
    )
  )
  WITH CHECK (
    bucket_id = 'documents' AND NOT is_staff() AND (
      ((storage.foldername(name))[1] = 'policies' AND EXISTS (
        SELECT 1 FROM public.clients c
        WHERE c.id::text = (storage.foldername(name))[2] AND c.email = public.current_user_email()
      ))
      OR
      ((storage.foldername(name))[1] = 'claims' AND EXISTS (
        SELECT 1 FROM public.claims cl
        JOIN public.policies p ON p.id = cl.policy_id
        JOIN public.clients c ON c.id = p.client_id
        WHERE cl.id::text = (storage.foldername(name))[2] AND c.email = public.current_user_email()
      ))
    )
  );
