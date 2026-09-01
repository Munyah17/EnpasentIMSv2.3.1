import { useState, useEffect, useMemo } from 'react'
import type { AssessmentPhoto, CropType, PolicyAssessmentSubject } from '../../types'
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

const OTHER = '__other__'

// The barn is what a barn-fire claim is assessed against, so its condition
// and capacity are recorded from both outside and inside before any loss.
const AGRICULTURE_PHOTO_SLOTS = ['Farm / Field Photo', 'Barn (exterior)', 'Barn (interior)']
const VEHICLE_PHOTO_SLOTS = ['Front', 'Rear', 'Left Side', 'Right Side', 'Odometer', 'Interior']
const MIN_PHOTOS = 6
const MAX_PHOTOS = 20

interface Props {
  policyId: string
  policyNumber: string
  /** Defaults to 'agriculture' for backward compatibility with existing
   *  callers; ViewPolicyModal passes 'vehicle' for motor policies. */
  subjectType?: PolicyAssessmentSubject
  onClose: () => void
  onSubmitted: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

/** Pre-loss baseline — establishes what's actually there (a crop on a farm,
 *  a vehicle's existing condition) before any claim exists, so a later
 *  claim can be checked against a real record instead of taken purely on
 *  faith. */
export default function PolicyAssessmentModal({ policyId, policyNumber, subjectType = 'agriculture', onClose, onSubmitted, showToast }: Props) {
  const { user } = useAuth()
  const isVehicle = subjectType === 'vehicle'
  const [cropTypeOptions, setCropTypeOptions] = useState<CropType[]>([])
  const [cropTypeChoice, setCropTypeChoice] = useState('')
  const [customCropType, setCustomCropType] = useState('')
  const cropType = cropTypeChoice === OTHER ? customCropType : cropTypeChoice
  const [cropPopulation, setCropPopulation] = useState('')
  const [plantDate, setPlantDate] = useState('')
  const [registrationNumber, setRegistrationNumber] = useState('')
  const [vehicleMake, setVehicleMake] = useState('')
  const [vehicleModel, setVehicleModel] = useState('')
  const [odometerReading, setOdometerReading] = useState('')
  const [existingDamage, setExistingDamage] = useState('')
  const [notes, setNotes] = useState('')
  // Barn capacity, recorded before any fire so a later claim is measured
  // against a declared baseline rather than a figure produced after the loss.
  const [barnHooks, setBarnHooks] = useState('')
  const [barnTiers, setBarnTiers] = useState('')
  const [barnBays, setBarnBays] = useState('')
  const [barnOwnership, setBarnOwnership] = useState('')
  const [barnUsage, setBarnUsage] = useState('')
  const [gpsLat, setGpsLat] = useState<number | undefined>(undefined)
  const [gpsLng, setGpsLng] = useState<number | undefined>(undefined)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [photos, setPhotos] = useState<Record<string, AssessmentPhoto | undefined>>({})
  const [extraPhotoLabels, setExtraPhotoLabels] = useState<string[]>([])
  const [offlinePending, setOfflinePending] = useState<{ label: string; file: File; exifDate?: string }[]>([])
  const [farmerSignature, setFarmerSignature] = useState<string | undefined>()
  const [assessorSignature, setAssessorSignature] = useState<string | undefined>()
  const [submitting, setSubmitting] = useState(false)
  /** Set by the first rejected submit; until then nothing is shown as wrong. */
  const [attempted, setAttempted] = useState(false)

  const baseSlots = isVehicle ? VEHICLE_PHOTO_SLOTS : AGRICULTURE_PHOTO_SLOTS
  const slots = [...baseSlots, ...extraPhotoLabels]
  const photoCount = Object.values(photos).filter(Boolean).length + offlinePending.length
  const capturedPhotos = Object.values(photos).filter((p): p is AssessmentPhoto => !!p)
  // A photo that can't account for when or how it was made is not a
  // baseline record -- this is the whole point of a pre-loss assessment,
  // so it blocks rather than merely warns.
  const rejected = blockedPhotos(capturedPhotos)
  // GPS is what ties this record to a specific field, and is what a later
  // claim gets checked against, so it's required rather than optional.
  const hasGps = gpsLat !== undefined && gpsLng !== undefined

  // Everything standing between this form and a saved assessment, named so
  // the assessor is told which ones rather than left with a dead button.
  const missing = useMemo<MissingField[]>(() => {
    const list: MissingField[] = []
    if (isVehicle) {
      if (!registrationNumber.trim()) list.push({ key: 'subject', label: 'Registration Number' })
    } else if (!cropType.trim()) {
      list.push({ key: 'subject', label: 'Crop Type', hint: cropTypeChoice === OTHER ? 'type the crop name in the box below the picker.' : undefined })
    }
    if (!hasGps) list.push({ key: 'gps', label: 'GPS Coordinates', hint: 'press “Use Current Location” while standing on site.' })
    if (photoCount < MIN_PHOTOS) {
      list.push({ key: 'photos', label: `Photos (${photoCount} of ${MIN_PHOTOS})`, hint: `${MIN_PHOTOS - photoCount} more still needed.` })
    }
    if (rejected.length > 0) {
      list.push({ key: 'photos', label: `${rejected.length} photo${rejected.length !== 1 ? 's' : ''} rejected`, hint: 'remove or re-shoot the photos listed in red below.' })
    }
    if (!farmerSignature) list.push({ key: 'farmerSignature', label: `${isVehicle ? 'Policyholder' : 'Farmer'} Signature` })
    if (!assessorSignature) list.push({ key: 'assessorSignature', label: 'Assessor Signature' })
    return list
  }, [isVehicle, registrationNumber, cropType, cropTypeChoice, hasGps, photoCount, rejected.length, farmerSignature, assessorSignature])

  const addExtraSlot = () => {
    setExtraPhotoLabels(prev => (baseSlots.length + prev.length >= MAX_PHOTOS ? prev : [...prev, `Additional Photo ${prev.length + 1}`]))
  }

  const removeExtraSlot = (label: string) => {
    setExtraPhotoLabels(prev => prev.filter(l => l !== label))
    setPhotos(prev => { const next = { ...prev }; delete next[label]; return next })
  }

  useEffect(() => {
    if (!isVehicle) db.cropTypes.list().then(({ data }) => setCropTypeOptions(data.filter(c => c.status === 'active')))
  }, [isVehicle])

  const captureGps = async () => {
    setGpsBusy(true)
    const coords = await getCurrentCoordinates()
    setGpsBusy(false)
    if (!coords) { showToast('warning', 'Could not get a GPS fix — check location permission and try again (this can take longer with a weak signal).'); return }
    setGpsLat(coords.lat)
    setGpsLng(coords.lng)
    // Also saves onto the policy itself, so the location is on record even
    // outside the assessment.
    void db.policies.update(policyId, { gpsLat: coords.lat, gpsLng: coords.lng })
  }

  const handleOfflineCapture = (file: File, label: string, exif?: { exifDate?: string }) => {
    setOfflinePending(prev => [...prev, { label, file, exifDate: exif?.exifDate }])
    showToast('warning', 'No connection: photo saved on this device and will upload once you\'re back online.')
  }

  const handleSubmit = async () => {
    setAttempted(true)
    if (missing.length > 0) {
      showToast('error', `Not saved: ${missing.length} required ${missing.length === 1 ? 'field is' : 'fields are'} missing — ${missing.map(m => m.label).join(', ')}.`)
      scrollToField(missing[0].key)
      return
    }
    if (!user) { showToast('error', 'Your session has expired; sign in again to save this assessment.'); return }
    if (submitting) return
    setSubmitting(true)
    const uploadedPhotos = Object.values(photos).filter((p): p is AssessmentPhoto => !!p)

    const formData = {
      assessorId: user.id, subjectType,
      cropType: isVehicle ? undefined : cropType, cropPopulation: isVehicle ? undefined : cropPopulation, plantDate: isVehicle ? undefined : plantDate,
      registrationNumber: isVehicle ? registrationNumber : undefined, vehicleMake: isVehicle ? vehicleMake : undefined,
      vehicleModel: isVehicle ? vehicleModel : undefined, odometerReading: isVehicle ? odometerReading : undefined,
      existingDamage: isVehicle ? existingDamage : undefined,
      notes, gpsLat, gpsLng, farmerSignature, assessorSignature,
      barnHooks: isVehicle ? undefined : Number(barnHooks) || undefined,
      barnTiers: isVehicle ? undefined : Number(barnTiers) || undefined,
      barnBays: isVehicle ? undefined : Number(barnBays) || undefined,
      barnOwnership: isVehicle ? undefined : barnOwnership || undefined,
      barnUsage: isVehicle ? undefined : barnUsage || undefined,
    }

    if (!navigator.onLine || offlinePending.length > 0) {
      const pendingPhotos = await Promise.all(offlinePending.map(async ({ label, file, exifDate }) => ({
        label, base64: await fileToBase64(file), mediaType: file.type, fileName: file.name, exifDate, capturedAt: new Date().toISOString(),
      })))
      queueAssessment('policy', policyId, { ...formData, _alreadyUploadedPhotos: uploadedPhotos }, pendingPhotos)
      showToast('success', 'Pre-loss assessment saved on this device; it will sync automatically once you\'re back online.')
      setSubmitting(false)
      onSubmitted()
      return
    }

    const { error } = await db.policyAssessments.create({
      policyId, ...formData, photos: uploadedPhotos, notes, syncStatus: 'synced',
    })
    setSubmitting(false)
    if (error) { showToast('error', error); return }
    const dupes = await checkAndRecordPhotoDuplicates(uploadedPhotos, 'policy', policyId, policyNumber)
    if (dupes.length > 0) {
      showToast('warning', `⚠ ${dupes.length > 1 ? 'Some photos' : 'A photo'} in this assessment appear to match one already used elsewhere; worth a second look.`)
    } else {
      showToast('success', 'Pre-loss assessment recorded.')
    }
    onSubmitted()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: isVehicle ? 640 : 560 }}>
        <div className="modal-header">
          <h3>Pre-Loss Assessment: {policyNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
            {isVehicle
              ? "Establishes the vehicle's condition before any claim exists; damage that was already there before cover started is an obvious red flag on a later claim."
              : "Establishes what's actually planted on this farm before any claim exists; a claim for a crop never recorded here is an obvious red flag."}
          </div>

          <ValidationSummary missing={missing} attempted={attempted} action="save" />

          {isVehicle ? (
            <>
              <div className="form-row">
                <div className="form-group" id={fieldId('subject')}>
                  <label>Registration Number *</label>
                  <input className={invalidClass(missing, attempted, 'subject')} value={registrationNumber} onChange={e => setRegistrationNumber(e.target.value)} placeholder="e.g. ABC 1234" />
                </div>
                <div className="form-group">
                  <label>Odometer Reading</label>
                  <input className="form-control" value={odometerReading} onChange={e => setOdometerReading(e.target.value)} placeholder="e.g. 84,200 km" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Make</label>
                  <input className="form-control" value={vehicleMake} onChange={e => setVehicleMake(e.target.value)} placeholder="e.g. Toyota" />
                </div>
                <div className="form-group">
                  <label>Model</label>
                  <input className="form-control" value={vehicleModel} onChange={e => setVehicleModel(e.target.value)} placeholder="e.g. Hilux" />
                </div>
              </div>
              <div className="form-group">
                <label>Existing Damage</label>
                <textarea className="form-control" rows={2} value={existingDamage} onChange={e => setExistingDamage(e.target.value)} placeholder="Any scratches, dents, or damage already present before cover starts…" />
              </div>
            </>
          ) : (
            <div className="form-row">
              <div className="form-group" id={fieldId('subject')}>
                <label>Crop Type *</label>
                <select className={invalidClass(missing, attempted, 'subject')} value={cropTypeChoice} onChange={e => setCropTypeChoice(e.target.value)}>
                  <option value="">Select crop…</option>
                  {cropTypeOptions.map(c => <option key={c.id} value={c.name}>{c.name}</option>)}
                  <option value={OTHER}>Other…</option>
                </select>
                {cropTypeChoice === OTHER && (
                  <input className={invalidClass(missing, attempted, 'subject')} style={{ marginTop: 6 }} value={customCropType} onChange={e => setCustomCropType(e.target.value)} placeholder="Enter crop type" autoFocus />
                )}
              </div>
              <div className="form-group">
                <label>Crop Population <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(e.g. 15,000 plants/ha)</span></label>
                <input className="form-control" value={cropPopulation} onChange={e => setCropPopulation(e.target.value)} placeholder="e.g. 15000 plants/ha" />
              </div>
            </div>
          )}

          {!isVehicle && (
            <div className="form-group">
              <label>Plant Date</label>
              <input type="date" className="form-control" value={plantDate} onChange={e => setPlantDate(e.target.value)} />
            </div>
          )}

          {!isVehicle && (
            <>
              <h4 style={{ margin: '1.25rem 0 4px' }}>Barn</h4>
              <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px' }}>
                Capacity and ownership are declared now, before any loss, so a barn-fire claim is
                measured against a record made in advance. Leave blank if this policy has no barn.
              </p>
              <div className="form-row">
                <div className="form-group">
                  <label>Number of Hooks</label>
                  <input type="number" className="form-control" min={0} value={barnHooks} onChange={e => setBarnHooks(e.target.value)} placeholder="e.g. 240" />
                </div>
                <div className="form-group">
                  <label>Number of Tiers</label>
                  <input type="number" className="form-control" min={0} value={barnTiers} onChange={e => setBarnTiers(e.target.value)} placeholder="e.g. 4" />
                </div>
                <div className="form-group">
                  <label>Number of Bays</label>
                  <input type="number" className="form-control" min={0} value={barnBays} onChange={e => setBarnBays(e.target.value)} placeholder="e.g. 3" />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Barn Ownership</label>
                  <select className="form-control" value={barnOwnership} onChange={e => setBarnOwnership(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="Owned by farmer">Owned by farmer</option>
                    <option value="Rented">Rented</option>
                    <option value="Shared">Shared with other growers</option>
                    <option value="Borrowed">Borrowed</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Barn Usage</label>
                  <select className="form-control" value={barnUsage} onChange={e => setBarnUsage(e.target.value)}>
                    <option value="">Select…</option>
                    <option value="This grower only">This grower's crop only</option>
                    <option value="Shared with other growers">Shared with other growers</option>
                    <option value="Also stores other goods">Also stores other goods</option>
                  </select>
                </div>
              </div>
            </>
          )}

          <div className={`form-group${isMissing(missing, attempted, 'gps') ? ' field-invalid-block' : ''}`} id={fieldId('gps')}>
            <label>GPS Coordinates *</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={gpsBusy} onClick={captureGps}>📍 {gpsBusy ? 'Getting location…' : 'Use Current Location'}</button>
              {hasGps ? (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{gpsLat!.toFixed(6)}, {gpsLng!.toFixed(6)}</span>
              ) : (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>Must be captured on site; coordinates can't be typed in.</span>
              )}
            </div>
          </div>

          <label id={fieldId('photos')} style={{ display: 'block', margin: '1rem 0 6px', fontSize: 13, fontWeight: 600, color: isMissing(missing, attempted, 'photos') ? 'var(--danger)' : undefined }}>
            Photos ({photoCount}/{MIN_PHOTOS} minimum, up to {MAX_PHOTOS})
          </label>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 8px' }}>
            Shoot with the Camera button. Screenshots, downloads, forwarded images and anything re-saved
            by an editor lose the metadata that proves when the photo was taken, and are rejected.
          </p>
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
          {slots.map(slot => (
            <div key={slot} style={{ position: 'relative' }}>
              <PhotoCaptureField
                label={slot}
                folder="policies"
                recordId={policyId}
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
          <button type="button" className="btn btn-ghost btn-sm" disabled={slots.length >= MAX_PHOTOS} onClick={addExtraSlot}>
            + Add More Images
          </button>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Notes</label>
            <textarea className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder={`Anything else worth recording about the ${isVehicle ? "vehicle's" : "farm's"} condition…`} />
          </div>

          <div className="form-row" style={{ marginTop: '1rem' }}>
            <div id={fieldId('farmerSignature')}>
              <SignaturePad label={`${isVehicle ? 'Policyholder' : 'Farmer'} Signature *`} onChange={setFarmerSignature} invalid={isMissing(missing, attempted, 'farmerSignature')} />
            </div>
            <div id={fieldId('assessorSignature')}>
              <SignaturePad label="Assessor Signature *" onChange={setAssessorSignature} invalid={isMissing(missing, attempted, 'assessorSignature')} />
            </div>
          </div>

          <ValidationSummary missing={missing} attempted={attempted} action="save" />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSubmit} disabled={submitting}>
            {submitting ? 'Saving…' : 'Save Assessment'}
          </button>
        </div>
      </div>
    </div>
  )
}
