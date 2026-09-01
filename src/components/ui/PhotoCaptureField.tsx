import { useRef, useState } from 'react'
import type { AssessmentPhoto } from '../../types'
import { uploadDocument, getDocumentUrl } from '../../lib/storage'
import { readExifSignals } from '../../lib/exifDate'
import { analyzePhotoForFraud, fileToBase64 } from '../../lib/photoAnalysis'
import { computePerceptualHash } from '../../lib/photoHash'
import { assessPhotoIntegrity } from '../../lib/photoIntegrity'
import { formatDateTime } from '../../lib/dateUtils'
import CameraCapture from './CameraCapture'

interface Props {
  label: string
  folder: 'claims' | 'policies'
  recordId: string
  claimDescription?: string
  value: AssessmentPhoto | undefined
  onChange: (photo: AssessmentPhoto | undefined) => void
  /** exifDate/exifHasData/exifSoftware/exifCamera are already read before
   *  the offline branch below — passed through so a photo captured offline
   *  doesn't lose its real capture-time EXIF evidence once it syncs. */
  onOfflineCapture?: (file: File, label: string, exif?: { exifDate?: string; exifHasData: boolean; exifSoftware?: string; exifCamera?: string }) => void
  /** Marks the whole field as a missing required entry (see
   *  components/ui/ValidationSummary.tsx). */
  invalid?: boolean
}

export default function PhotoCaptureField({ label, folder, recordId, claimDescription, value, onChange, onOfflineCapture, invalid }: Props) {
  const [busy, setBusy] = useState(false)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [cameraOpen, setCameraOpen] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const galleryRef = useRef<HTMLInputElement>(null)

  const handleFile = async (file: File | null, live = false) => {
    if (!file) return
    setBusy(true)
    const capturedAt = new Date().toISOString()

    const exif = await readExifSignals(file)

    const exifPayload = { exifDate: exif.dateTaken ?? undefined, exifHasData: exif.hasExif, exifSoftware: exif.software ?? undefined, exifCamera: [exif.make, exif.model].filter(Boolean).join(' ') || undefined }

    if (!navigator.onLine) {
      // No connection right now — hand the raw file to the offline queue
      // instead of losing it; a background sync uploads it later.
      onOfflineCapture?.(file, label, exifPayload)
      setBusy(false)
      return
    }

    const { data, error } = await uploadDocument(folder, recordId, new File([file], `assessment_${label.replace(/\s+/g, '-')}_${file.name}`, { type: file.type }))
    if (error || !data) {
      // Upload failed (likely a flaky connection mid-upload) — fall back to
      // the offline queue rather than surfacing a dead end.
      onOfflineCapture?.(file, label, exifPayload)
      setBusy(false)
      return
    }

    const url = await getDocumentUrl(data.path)
    setPreviewUrl(url)

    let visibleDateStamp: string | undefined
    let aiNote: string | undefined
    let aiFlagged = false
    try {
      const base64 = await fileToBase64(file)
      const result = await analyzePhotoForFraud(base64, file.type, label, claimDescription)
      if (!result.simulated) {
        visibleDateStamp = result.visibleDateStamp ?? undefined
        aiNote = result.note
        aiFlagged = !!result.flagged
      }
    } catch { /* AI check is best-effort — never block on it */ }

    const phash = await computePerceptualHash(file)

    onChange({
      path: data.path, label,
      exifDate: exif.dateTaken ?? undefined,
      exifHasData: exif.hasExif,
      exifSoftware: exif.software ?? undefined,
      exifCamera: [exif.make, exif.model].filter(Boolean).join(' ') || undefined,
      visibleDateStamp, aiNote, aiFlagged, capturedAt, phash: phash ?? undefined,
      capturedLive: live || undefined,
    })
    setBusy(false)
  }

  const concerns = value ? assessPhotoIntegrity(value) : []

  return (
    <div className={`photo-capture-field${invalid ? ' field-invalid-block' : ''}`}>
      <div className="photo-capture-header">
        <span className="photo-capture-label">{label}</span>
        {value && (
          <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => { onChange(undefined); setPreviewUrl(null) }}>Remove</button>
        )}
      </div>

      {!value ? (
        <div className="photo-capture-actions">
          {/* Only ever reached when the in-page camera can't run on this
              device — CameraCapture hands off to it rather than dead-ending. */}
          {/* Not marked as shot in-app: this hands off to the phone's own
              camera app, and what comes back is a file chosen through the
              OS picker. A real camera photo carries its own Exif, which is
              what vouches for it here. */}
          <input ref={cameraRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handleFile(f) }} />
          <input ref={galleryRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={e => { const f = e.target.files?.[0] ?? null; e.target.value = ''; void handleFile(f) }} />
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => setCameraOpen(true)}>📷 Camera</button>
          <button type="button" className="btn btn-outline btn-sm" disabled={busy} onClick={() => galleryRef.current?.click()}>🖼 Gallery</button>
          {busy && <span className="photo-capture-busy">Uploading &amp; analysing…</span>}
        </div>
      ) : (
        <div className="photo-capture-result">
          {previewUrl && <img src={previewUrl} alt={label} className="photo-capture-thumb" />}
          <div className="photo-capture-meta">
            {value.capturedLive && <div style={{ color: 'var(--teal)' }}>🔒 Shot in-app on this device</div>}
            {value.exifDate && <div>📅 EXIF: {formatDateTime(value.exifDate)}</div>}
            {!value.exifDate && value.capturedLive && <div>📅 Taken: {formatDateTime(value.capturedAt)}</div>}
            {value.visibleDateStamp && <div>🏷 Visible date stamp: {value.visibleDateStamp}</div>}
            {value.exifCamera && <div>📷 {value.exifCamera}</div>}
            {concerns.map((c, i) => (
              <div key={i} className="photo-capture-flag" style={c.severity === 'advisory' ? { color: 'var(--gold)' } : undefined}>
                {c.severity === 'blocking' ? '⛔' : '⚠'} {c.message}
              </div>
            ))}
          </div>
        </div>
      )}

      {cameraOpen && (
        <CameraCapture
          label={label}
          onClose={() => setCameraOpen(false)}
          onCapture={file => { setCameraOpen(false); void handleFile(file, true) }}
          onUseDeviceCamera={() => { setCameraOpen(false); cameraRef.current?.click() }}
        />
      )}
    </div>
  )
}
