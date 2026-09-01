import { supabase } from './supabase'

/** Matches the bucket's own allowed_mime_types (database/add_document_storage.sql) —
 *  kept in sync manually since Supabase Storage doesn't expose that list to a client read. */
export const ACCEPTED_DOCUMENT_TYPES =
  '.pdf,.csv,.xls,.xlsx,.doc,.docx,.rtf,.jpg,.jpeg,.png,.webp,application/pdf,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,application/rtf,text/rtf,image/jpeg,image/png,image/webp'

const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10MB — matches the bucket's file_size_limit

export interface UploadedDocument {
  /** Storage path, e.g. "claims/<claim-id>/1712345-receipt.pdf" — this is
   *  what gets stored in a documents/attachments TEXT[] column. */
  path: string
  name: string
}

/** Uploads into documents/<folder>/<recordId>/<timestamp>-<filename>, so
 *  RLS (add_document_storage.sql) can scope access by folder + record id
 *  without needing per-file metadata. */
export async function uploadDocument(
  folder: 'claims' | 'policies' | 'tickets',
  recordId: string,
  file: File,
): Promise<{ data: UploadedDocument | null; error: string | null }> {
  if (file.size > MAX_FILE_BYTES) {
    return { data: null, error: `${file.name} is larger than 10MB.` }
  }
  const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, '_')
  const path = `${folder}/${recordId}/${Date.now()}-${safeName}`
  const { error } = await supabase.storage.from('documents').upload(path, file, { upsert: false })
  if (error) return { data: null, error: error.message }
  return { data: { path, name: file.name }, error: null }
}

/** Documents live in a private bucket, so viewing/downloading needs a
 *  short-lived signed URL rather than a public one. */
export async function getDocumentUrl(path: string): Promise<string | null> {
  const { data, error } = await supabase.storage.from('documents').createSignedUrl(path, 300)
  if (error || !data) return null
  return data.signedUrl
}

export async function deleteDocument(path: string): Promise<{ error: string | null }> {
  const { error } = await supabase.storage.from('documents').remove([path])
  return { error: error?.message ?? null }
}

/** Path's last segment is "<timestamp>-<original name>" — strip the
 *  timestamp prefix back off for display. */
export function documentDisplayName(path: string): string {
  const last = path.split('/').pop() ?? path
  return last.replace(/^\d+-/, '')
}
