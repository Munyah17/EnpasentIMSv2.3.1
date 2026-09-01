import { useState } from 'react'
import { uploadDocument, getDocumentUrl, deleteDocument, documentDisplayName, ACCEPTED_DOCUMENT_TYPES } from '../../lib/storage'

interface Props {
  folder: 'claims' | 'policies' | 'tickets'
  /** Folder key under documents/<folder>/<recordId>/... — doesn't need to
   *  be the record's real id (staff Storage access isn't scoped by it; see
   *  database/add_document_storage.sql), just stable for this form's session. */
  recordId: string
  paths: string[]
  onChange: (paths: string[]) => void
  showToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

export default function DocumentUpload({ folder, recordId, paths, onChange, showToast }: Props) {
  const [uploading, setUploading] = useState(false)

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return
    setUploading(true)
    const uploaded: string[] = []
    for (const file of Array.from(files)) {
      const { data, error } = await uploadDocument(folder, recordId, file)
      if (error) { if (showToast) showToast('error', error); continue }
      if (data) uploaded.push(data.path)
    }
    setUploading(false)
    if (uploaded.length) onChange([...paths, ...uploaded])
  }

  const handleView = async (path: string) => {
    const url = await getDocumentUrl(path)
    if (!url) { if (showToast) showToast('error', 'Could not open that document.'); return }
    window.open(url, '_blank', 'noopener,noreferrer')
  }

  const handleRemove = async (path: string) => {
    await deleteDocument(path)
    onChange(paths.filter(p => p !== path))
  }

  return (
    <div>
      <label className="btn btn-ghost btn-sm" style={{ display: 'inline-block', cursor: 'pointer' }}>
        {uploading ? 'Uploading…' : '📎 Attach Document'}
        <input
          type="file"
          multiple
          accept={ACCEPTED_DOCUMENT_TYPES}
          onChange={e => { handleFiles(e.target.files); e.target.value = '' }}
          disabled={uploading}
          style={{ display: 'none' }}
        />
      </label>
      <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0' }}>PDF, CSV, Excel, Word, RTF, or image (up to 10MB each).</p>
      {paths.length > 0 && (
        <ul style={{ listStyle: 'none', marginTop: 8, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {paths.map(path => (
            <li key={path} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12 }}>
              <button type="button" onClick={() => handleView(path)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>
                📄 {documentDisplayName(path)}
              </button>
              <button type="button" onClick={() => handleRemove(path)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--danger)', cursor: 'pointer', fontSize: 12 }} title="Remove">✕</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
