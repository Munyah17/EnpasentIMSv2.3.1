import { useState, useMemo } from 'react'
import type { AssessmentPhoto } from '../../types'
import { useAuth } from '../../contexts/AuthContext'
import { db } from '../../lib/db'
import { getCurrentCoordinates } from '../../lib/geolocation'
import { queueAssessment } from '../../lib/offlineQueue'
import { fileToBase64 } from '../../lib/photoAnalysis'
import { checkAndRecordPhotoDuplicates } from '../../lib/duplicatePhotoCheck'
import { blockedPhotos } from '../../lib/photoIntegrity'
import PhotoCaptureField from '../ui/PhotoCaptureField'
import SignaturePad from '../ui/SignaturePad'
import ValidationSummary, { fieldId, invalidClass, isMissing, scrollToField } from '../ui/ValidationSummary'
import type { MissingField } from '../ui/ValidationSummary'

interface Props {
  claimId: string
  claimNumber: string
  claimDescription: string
  /** Crop population recorded at pre-loss for this policy, if there is one.
   *  Prefilled here so the assessor works from the established baseline
   *  rather than re-estimating it after the damage. */
  baselineCropPopulation?: string
  onClose: () => void
  onSubmitted: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

const PHOTO_SLOTS = ['Barn (exterior)', 'Barn (interior)', 'Crop damage (wide shot)', 'Crop damage (close-up)']
const MIN_PHOTOS = 6
const MAX_PHOTOS = 20

export default function AgricultureAssessmentModal({ claimId, claimNumber, claimDescription, baselineCropPopulation, onClose, onSubmitted, showToast }: Props) {
  const { user } = useAuth()
  const [descriptionOfLoss, setDescriptionOfLoss] = useState('')
  const [photos, setPhotos] = useState<Record<string, AssessmentPhoto | undefined>>({})
  const [extraPhotoLabels, setExtraPhotoLabels] = useState<string[]>([])
  const [assessorComments, setAssessorComments] = useState('')
  const [farmerStatement, setFarmerStatement] = useState('')
  const [gpsLat, setGpsLat] = useState<number | undefined>(undefined)
  const [gpsLng, setGpsLng] = useState<number | undefined>(undefined)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [cropPopulation, setCropPopulation] = useState(baselineCropPopulation ?? '')
  const [cropStage, setCropStage] = useState('')
  const [barnCapacity, setBarnCapacity] = useState('')
  const [farmerSignature, setFarmerSignature] = useState<string | undefined>()
  const [assessorSignature, setAssessorSignature] = useState<string | undefined>()
  const [farmerSelfie, setFarmerSelfie] = useState<AssessmentPhoto | undefined>()
  const [submitting, setSubmitting] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [offlinePending, setOfflinePending] = useState<{ label: string; file: File; exifDate?: string }[]>([])

  const allSlots = [...PHOTO_SLOTS, ...extraPhotoLabels]
  const photoCount = Object.values(photos).filter(Boolean).length + offlinePending.length
  const capturedPhotos = [...Object.values(photos).filter((p): p is AssessmentPhoto => !!p), ...(farmerSelfie ? [farmerSelfie] : [])]
  // The banner above this form promises photos are checked for age and
  // provenance automatically. This is that check — the same one pre-loss
  // applies, and it matters more here because this is the assessment a
  // payout is calculated from.
  const rejected = blockedPhotos(capturedPhotos)

  const missing = useMemo<MissingField[]>(() => {
    const list: MissingField[] = []
    if (!descriptionOfLoss.trim()) list.push({ key: 'descriptionOfLoss', label: 'Description of Loss' })
    if (photoCount < MIN_PHOTOS) {
      list.push({ key: 'photos', label: `Photos (${photoCount} of ${MIN_PHOTOS})`, hint: `${MIN_PHOTOS - photoCount} more still needed.` })
    }
    if (rejected.length > 0) {
      list.push({ key: 'photos', label: `${rejected.length} photo${rejected.length !== 1 ? 's' : ''} rejected`, hint: 'remove or re-shoot the photos listed in red below.' })
    }
    if (!farmerSignature) list.push({ key: 'farmerSignature', label: 'Farmer Signature' })
    if (!assessorSignature) list.push({ key: 'assessorSignature', label: 'Assessor Signature' })
    return list
  }, [descriptionOfLoss, photoCount, rejected.length, farmerSignature, assessorSignature])

  const captureGps = async () => {
    setGpsBusy(true)
    const coords = await getCurrentCoordinates()
    setGpsBusy(false)
    if (!coords) { showToast('warning', 'Could not get a GPS fix — check location permission and try again (this can take longer with a weak signal).'); return }
    setGpsLat(coords.lat)
    setGpsLng(coords.lng)
  }

  const addExtraSlot = () => {
    setExtraPhotoLabels(prev => (PHOTO_SLOTS.length + prev.length >= MAX_PHOTOS ? prev : [...prev, `Additional Photo ${prev.length + 1}`]))
  }

  const removeExtraSlot = (label: string) => {
    setExtraPhotoLabels(prev => prev.filter(l => l !== label))
    setPhotos(prev => { const next = { ...prev }; delete next[label]; return next })
  }

  const handleOfflineCapture = (file: File, label: string, exif?: { exifDate?: string }) => {
    setOfflinePending(prev => [...prev, { label, file, exifDate: exif?.exifDate }])
    showToast('warning', `No connection: "${label}" saved on this device and will upload automatically once you're back online.`)
  }

  const handleSubmit = async () => {
    setAttempted(true)
    if (missing.length > 0) {
      showToast('error', `Not submitted: ${missing.length} required ${missing.length === 1 ? 'field is' : 'fields are'} missing — ${missing.map(m => m.label).join(', ')}.`)
      scrollToField(missing[0].key)
      return
    }
    if (!user) { showToast('error', 'Your session has expired; sign in again to submit this assessment.'); return }
    if (submitting) return
    setSubmitting(true)

    const uploadedPhotos = Object.values(photos).filter((p): p is AssessmentPhoto => !!p)
    if (farmerSelfie) uploadedPhotos.push(farmerSelfie)

    if (!navigator.onLine || offlinePending.length > 0) {
      // Whole assessment goes into the offline queue together — some
      // photos may already be uploaded (online ones), the rest travel as
      // raw files and get uploaded when the queue flushes.
      const pendingPhotos = await Promise.all(offlinePending.map(async ({ label, file, exifDate }) => ({
        label, base64: await fileToBase64(file), mediaType: file.type, fileName: file.name, exifDate, capturedAt: new Date().toISOString(),
      })))
      queueAssessment('claim', claimId, {
        assessorId: user.id, descriptionOfLoss, assessorComments, farmerStatement,
        gpsLat, gpsLng, cropPopulation, cropStage, barnCapacity,
        farmerSignature, assessorSignature, farmerSelfie: farmerSelfie?.path,
        _alreadyUploadedPhotos: uploadedPhotos,
      }, pendingPhotos)
      showToast('success', 'Assessment saved on this device; it will sync automatically once you\'re back online.')
      setSubmitting(false)
      onSubmitted()
      return
    }

    const { error } = await db.claimAssessments.create({
      claimId,
      assessorId: user.id,
      descriptionOfLoss,
      photos: uploadedPhotos,
      assessorComments,
      farmerStatement,
      gpsLat, gpsLng, cropPopulation, cropStage, barnCapacity,
      farmerSignature, assessorSignature, farmerSelfie: farmerSelfie?.path,
      submittedAt: new Date().toISOString(),
      syncStatus: 'synced',
    })
    setSubmitting(false)
    if (error) { showToast('error', error); return }
    const dupes = await checkAndRecordPhotoDuplicates(uploadedPhotos, 'claim', claimId, claimNumber)
    if (dupes.length > 0) {
      showToast('warning', `⚠ ${dupes.length} photo${dupes.length !== 1 ? 's' : ''} in this assessment appear to match photos already used on another claim/policy; worth a second look.`)
    } else {
      showToast('success', 'Physical assessment submitted.')
    }
    onSubmitted()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 720 }}>
        <div className="modal-header">
          <h3>Physical Assessment: {claimNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
            Agriculture claims require a physical site visit before they can go to final review. Photos must be no more than 3 days old; this is checked automatically from each photo's date metadata and, where available, a visible on-image date stamp.
          </div>

          <ValidationSummary missing={missing} attempted={attempted} />

          <div className="form-group" id={fieldId('descriptionOfLoss')}>
            <label>Description of Loss (if no other proof) *</label>
            <textarea className={invalidClass(missing, attempted, 'descriptionOfLoss')} rows={3} value={descriptionOfLoss} onChange={e => setDescriptionOfLoss(e.target.value)} placeholder="Describe what happened and what you observed on site…" />
          </div>

          <div className="form-group">
            <label>Farmer's Statement</label>
            <textarea className="form-control" rows={3} value={farmerStatement} onChange={e => setFarmerStatement(e.target.value)} placeholder="Summarize, in your own words, what the farmer told you on site, kept separate from your own remarks below." />
          </div>

          <label id={fieldId('photos')} style={{ display: 'block', margin: '1rem 0 6px', fontSize: 13, fontWeight: 600, color: isMissing(missing, attempted, 'photos') ? 'var(--danger)' : undefined }}>
            Photos ({photoCount}/{MIN_PHOTOS} minimum, up to {MAX_PHOTOS})
          </label>
          {rejected.length > 0 && (
            <div className="info-banner info-banner-danger" style={{ marginBottom: 10 }}>
              <strong>{rejected.length} photo{rejected.length !== 1 ? 's' : ''} cannot be accepted:</strong>
              <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 12 }}>
                {rejected.map(({ photo, concerns }) => (
                  <li key={photo.label}>{photo.label}: {concerns.map(c => c.message).join(' ')}</li>
                ))}
              </ul>
            </div>
          )}
          {allSlots.map(slot => (
            <div key={slot} style={{ position: 'relative' }}>
              <PhotoCaptureField
                label={slot}
                folder="claims"
                recordId={claimId}
                claimDescription={claimDescription}
                value={photos[slot]}
                onChange={p => setPhotos(prev => ({ ...prev, [slot]: p }))}
                onOfflineCapture={handleOfflineCapture}
              />
              {extraPhotoLabels.includes(slot) && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  style={{ position: 'absolute', top: 0, right: 0, color: 'var(--danger)' }}
                  onClick={() => removeExtraSlot(slot)}
                >
                  Remove
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm" disabled={allSlots.length >= MAX_PHOTOS} onClick={addExtraSlot}>
            + Add More Images
          </button>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Assessor's Comments (after reviewing the photos)</label>
            <textarea className="form-control" rows={3} value={assessorComments} onChange={e => setAssessorComments(e.target.value)} placeholder="Your analysis of the damage and evidence…" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Crop Population <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(e.g. 15,000 plants/ha)</span></label>
              <input className="form-control" value={cropPopulation} onChange={e => setCropPopulation(e.target.value)} placeholder="e.g. 15000 plants/ha" />
            </div>
            <div className="form-group">
              <label>Crop Stage <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(e.g. tobacco, leaf stage)</span></label>
              <input className="form-control" value={cropStage} onChange={e => setCropStage(e.target.value)} placeholder="e.g. Tobacco, leaf stage" />
            </div>
          </div>
          <div className="form-group">
            <label>Barn Capacity</label>
            <input className="form-control" value={barnCapacity} onChange={e => setBarnCapacity(e.target.value)} placeholder="e.g. 12 tonnes" />
          </div>

          <div className="form-group">
            <label>GPS Coordinates</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={gpsBusy} onClick={captureGps}>📍 {gpsBusy ? 'Getting location…' : 'Use Current Location'}</button>
              {gpsLat !== undefined && gpsLng !== undefined && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{gpsLat.toFixed(6)}, {gpsLng.toFixed(6)}</span>
              )}
            </div>
          </div>

          <div className="form-group">
            <label>Farmer Selfie</label>
            <PhotoCaptureField label="Farmer Selfie" folder="claims" recordId={claimId} value={farmerSelfie} onChange={setFarmerSelfie} onOfflineCapture={handleOfflineCapture} />
          </div>

          <div className="form-row" style={{ marginTop: '1rem' }}>
            <div id={fieldId('farmerSignature')}>
              <SignaturePad label="Farmer Signature *" onChange={setFarmerSignature} invalid={isMissing(missing, attempted, 'farmerSignature')} />
            </div>
            <div id={fieldId('assessorSignature')}>
              <SignaturePad label="Assessor Signature *" onChange={setAssessorSignature} invalid={isMissing(missing, attempted, 'assessorSignature')} />
            </div>
          </div>

          <ValidationSummary missing={missing} attempted={attempted} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Submitting…' : 'Submit Assessment'}
          </button>
        </div>
      </div>
    </div>
  )
}
