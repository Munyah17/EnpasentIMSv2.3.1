import { useState, useEffect, useMemo } from 'react'
import type { Claim, Policy, Client, Product, AssessmentPhoto, ClaimAssessment } from '../../types'
import { db } from '../../lib/db'
import { scoreClaimFraud } from '../../lib/aiService'
import { getCurrentCoordinates } from '../../lib/geolocation'
import { fileToBase64 } from '../../lib/photoAnalysis'
import { useAuth } from '../../contexts/AuthContext'
import DateInput from '../ui/DateInput'
import PhotoCaptureField from '../ui/PhotoCaptureField'
import SignaturePad from '../ui/SignaturePad'
import ValidationSummary, { fieldId, invalidClass, isMissing, scrollToField } from '../ui/ValidationSummary'
import type { MissingField } from '../ui/ValidationSummary'
import FraudNoticeModal from './FraudNoticeModal'
import {
  PLANTS_PER_HECTARE, TYPICAL_LEAVES_AT_TOPPING,
  expectedLeavesForHectares, stringsFromBarnCapacity, leavesInBarn,
  assessLoss, calculateClaim, formatPercent, formatMoney,
} from '../../lib/agricultureClaim'

export interface PendingOfflinePhoto {
  label: string
  base64: string
  mediaType: string
  fileName: string
  exifDate?: string
  capturedAt: string
}

interface Props {
  onClose: () => void
  onSave: (
    claim: Claim & { fraudSignals?: string[] },
    assessment: Omit<ClaimAssessment, 'id' | 'claimId' | 'claimNumber' | 'assessorName' | 'createdAt'>,
    offlinePhotos: PendingOfflinePhoto[],
  ) => Promise<void>
  showToast?: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
  claimKind?: 'ordinary' | 'agriculture'
  onSwitchKind?: (kind: 'ordinary' | 'agriculture') => void
}

// Restricted to the perils actually covered by agriculture policies (see
// AGRICULTURE_COVER in exportUtils.ts) so a farmer can't file a claim
// against a peril their cover doesn't include.
const CLAIM_TYPES = ['Hail Storm', 'Barn Fire', 'Wind Storm', 'Other']

const THREE_DAYS_MS = 3 * 24 * 3600 * 1000
function isPhotoStale(p: AssessmentPhoto): boolean {
  const dateStr = p.exifDate || p.visibleDateStamp
  if (!dateStr) return false
  const ts = new Date(dateStr).getTime()
  return Number.isFinite(ts) && Date.now() - ts > THREE_DAYS_MS
}

// At least 6 clearly-labeled damage photos, matching what a real assessment
// needs to hold up — "+ Add Another" appends more beyond these.
const REQUIRED_PHOTO_SLOTS = [
  'Damage (Wide Shot 1)', 'Damage (Wide Shot 2)',
  'Damage (Close-up 1)', 'Damage (Close-up 2)',
  'Field/Barn Overview', 'Additional Evidence',
]
const MAX_PHOTOS = 20

export default function NewAgricultureClaimModal({ onClose, onSave, showToast, claimKind, onSwitchKind }: Props) {
  const { user } = useAuth()
  const [policies, setPolicies] = useState<Policy[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [allClaims, setAllClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [policyNumberInput, setPolicyNumberInput] = useState('')
  const [claimType, setClaimType] = useState(CLAIM_TYPES[0])
  const [amount, setAmount] = useState('')
  const [dateOfEvent, setDateOfEvent] = useState('')
  const [description, setDescription] = useState('')
  const [client, setClient] = useState<Client | null>(null)
  const [saving, setSaving] = useState(false)

  // Assessment fields — same shape as AgricultureAssessmentModal, captured
  // here at intake instead of as a separate later step.
  const [descriptionOfLoss, setDescriptionOfLoss] = useState('')
  const [photos, setPhotos] = useState<Record<string, AssessmentPhoto | undefined>>({})
  const [extraPhotoLabels, setExtraPhotoLabels] = useState<string[]>([])
  const [assessorComments, setAssessorComments] = useState('')
  const [farmerStatement, setFarmerStatement] = useState('')
  const [gpsLat, setGpsLat] = useState<number | undefined>(undefined)
  const [gpsLng, setGpsLng] = useState<number | undefined>(undefined)
  const [gpsBusy, setGpsBusy] = useState(false)
  const [cropPopulation, setCropPopulation] = useState('')
  const [baselineCropPopulation, setBaselineCropPopulation] = useState<string | undefined>()
  // Loss assessment inputs. Which of these apply depends on the peril:
  // field counts for hail/windstorm, barn counts for a barn fire.
  const [hectares, setHectares] = useState('')
  const [damagedLeaves, setDamagedLeaves] = useState('')
  /** Leaves per plant, counted in the field at topping. */
  const [leavesAtTopping, setLeavesAtTopping] = useState(String(TYPICAL_LEAVES_AT_TOPPING))
  const [leavesPerString, setLeavesPerString] = useState('')
  // Barn dimensions, prefilled from the pre-loss record where one exists.
  const [barnHooks, setBarnHooks] = useState('')
  const [barnTiers, setBarnTiers] = useState('')
  const [barnBays, setBarnBays] = useState('')
  const [barnFromPreLoss, setBarnFromPreLoss] = useState(false)
  const [cropStage, setCropStage] = useState('')
  const [barnCapacity, setBarnCapacity] = useState('')
  const [farmerSignature, setFarmerSignature] = useState<string | undefined>()
  const [assessorSignature, setAssessorSignature] = useState<string | undefined>()
  const [farmerSelfie, setFarmerSelfie] = useState<AssessmentPhoto | undefined>()
  const [offlinePending, setOfflinePending] = useState<{ label: string; file: File; exifDate?: string }[]>([])
  const [showFraudNotice, setShowFraudNotice] = useState(false)
  const [attempted, setAttempted] = useState(false)

  // Stable draft id so uploaded photos land in one folder before the claim's
  // real id exists — same pattern as NewClaimModal.
  const [draftId] = useState(() => `cl${Date.now()}`)

  useEffect(() => {
    Promise.all([db.policies.list(), db.claims.list(), db.products.list()]).then(([polRes, claimRes, prodRes]) => {
      if (polRes.data) setPolicies(polRes.data)
      if (claimRes.data) setAllClaims(claimRes.data)
      if (prodRes.data) setProducts(prodRes.data)
      setLoading(false)
    })
  }, [])

  const agriculturePolicies = policies.filter(p => products.find(pr => pr.id === p.productId)?.category === 'agriculture')
  const policy = agriculturePolicies.find(p => p.policyNumber.toLowerCase() === policyNumberInput.trim().toLowerCase())
  const policyId = policy?.id ?? ''

  // The amount is never seeded from the cover limit: on this form it is the
  // assessed payable figure, and pre-filling the sum insured meant a claim
  // submitted before the leaf counts were entered went in for the full
  // policy value. It stays empty until the calculation below produces it.
  useEffect(() => {
    setAmount('')
    if (policy) {
      db.clients.get(policy.clientId).then(({ data }) => setClient(data))
    } else {
      setClient(null)
      setBaselineCropPopulation(undefined)
    }
  }, [policy])

  // Crop population is established at pre-loss and carried forward, so the
  // assessor is comparing against the recorded baseline rather than
  // re-estimating it from scratch at claim time. Still editable: if what's
  // in the field genuinely differs, that difference is itself evidence.
  useEffect(() => {
    if (!policyId) return
    let cancelled = false
    db.policyAssessments.listForPolicy(policyId).then(({ data }) => {
      if (cancelled) return
      const baseline = data.find(a => (a.cropPopulation ?? '').trim())?.cropPopulation?.trim()
      setBaselineCropPopulation(baseline || undefined)
      if (baseline) setCropPopulation(prev => prev.trim() ? prev : baseline)

      // The barn was measured before the fire, which is the whole point of
      // recording it then. Carried forward so the assessor is working from
      // the declared baseline rather than measuring a burnt structure.
      const barn = data.find(a => a.barnHooks || a.barnTiers || a.barnBays)
      if (barn) {
        setBarnFromPreLoss(true)
        if (barn.barnHooks) setBarnHooks(prev => prev || String(barn.barnHooks))
        if (barn.barnTiers) setBarnTiers(prev => prev || String(barn.barnTiers))
        if (barn.barnBays) setBarnBays(prev => prev || String(barn.barnBays))
      }
    })
    return () => { cancelled = true }
  }, [policyId])

  // ── Loss assessment, derived ────────────────────────────────────
  // Barn fire counts leaf already in the barn; hail and windstorm count
  // damage in the field. Both are measured against the whole expected crop.
  const isBarnFire = claimType === 'Barn Fire'
  // Expected crop: 15,000 plants per hectare, times the leaves actually
  // counted at topping.
  const leavesExpected = expectedLeavesForHectares(Number(hectares), Number(leavesAtTopping))
  // Barn capacity in strings is hooks x tiers x bays, never typed directly.
  const barnStrings = stringsFromBarnCapacity(Number(barnHooks), Number(barnTiers), Number(barnBays))
  const barnLeafCount = leavesInBarn(barnStrings, Number(leavesPerString))
  // A barn fire destroys what was in the barn; hail and wind damage what is
  // still standing in the field.
  const countedLoss = isBarnFire ? barnLeafCount : Number(damagedLeaves)
  const lossAssessment = assessLoss(countedLoss, leavesExpected)
  const claimCalc = calculateClaim(lossAssessment.percentageLoss, policy?.coverAmount ?? 0)
  // Nothing is shown until there is a real basis for it: a bare "$0.00"
  // reads like an assessed nil loss rather than an unanswered question.
  const calcReady = lossAssessment.leavesExpected > 0 && lossAssessment.leavesLost > 0 && !!policy

  // The claim amount IS the payable figure, so it follows the assessment
  // rather than defaulting to the full cover limit -- the old behaviour made
  // every agriculture claim look like a total loss.
  useEffect(() => {
    if (lossAssessment.leavesLost > 0 && lossAssessment.leavesExpected > 0) {
      setAmount(String(claimCalc.claimPayable))
    }
  }, [claimCalc.claimPayable, lossAssessment.leavesLost, lossAssessment.leavesExpected])

  const allSlots = [...REQUIRED_PHOTO_SLOTS, ...extraPhotoLabels]
  const isSlotCovered = (slot: string) => !!photos[slot] || offlinePending.some(p => p.label === slot)
  const requiredPhotoCount = REQUIRED_PHOTO_SLOTS.filter(isSlotCovered).length
  const photosComplete = requiredPhotoCount >= REQUIRED_PHOTO_SLOTS.length
  const farmerPhotoCovered = !!farmerSelfie || offlinePending.some(p => p.label === 'Farmer Photo')

  const captureGps = async () => {
    setGpsBusy(true)
    const coords = await getCurrentCoordinates()
    setGpsBusy(false)
    if (!coords) { showToast?.('warning', 'Could not get a GPS fix — check location permission and try again (this can take longer with a weak signal).'); return }
    setGpsLat(coords.lat)
    setGpsLng(coords.lng)
  }

  const addExtraSlot = () => {
    setExtraPhotoLabels(prev => (REQUIRED_PHOTO_SLOTS.length + prev.length >= MAX_PHOTOS ? prev : [...prev, `Additional Photo ${prev.length + 1}`]))
  }

  const removeExtraSlot = (label: string) => {
    setExtraPhotoLabels(prev => prev.filter(l => l !== label))
    setPhotos(prev => { const next = { ...prev }; delete next[label]; return next })
  }

  const handleOfflineCapture = (file: File, label: string, exif?: { exifDate?: string }) => {
    setOfflinePending(prev => [...prev, { label, file, exifDate: exif?.exifDate }])
    showToast?.('warning', `No connection: "${label}" saved on this device and will upload automatically once you're back online.`)
  }

  const missing = useMemo<MissingField[]>(() => {
    const list: MissingField[] = []
    if (!policyId) list.push({ key: 'policyNumber', label: 'Policy Number', hint: 'must match an existing agriculture policy.' })
    if (!dateOfEvent) list.push({ key: 'dateOfEvent', label: 'Date of Event' })
    if (!description.trim()) list.push({ key: 'description', label: 'Description' })
    if (!descriptionOfLoss.trim()) list.push({ key: 'descriptionOfLoss', label: 'Description of Loss' })
    if (!photosComplete) {
      list.push({ key: 'photos', label: `Damage Photos (${requiredPhotoCount} of ${REQUIRED_PHOTO_SLOTS.length})`, hint: 'every labelled slot needs its own photo.' })
    }

    // The loss assessment is the claim: the payable amount is derived from
    // these counts and nothing else, so a claim cannot be submitted without
    // them. Which ones apply depends on the peril.
    if (!(Number(hectares) > 0)) list.push({ key: 'hectares', label: 'Hectares Under Crop' })
    if (!(Number(leavesAtTopping) > 0)) list.push({ key: 'leavesAtTopping', label: 'Leaves at Topping' })
    if (isBarnFire) {
      if (!(Number(barnHooks) > 0)) list.push({ key: 'barnHooks', label: 'Number of Hooks' })
      if (!(Number(barnTiers) > 0)) list.push({ key: 'barnTiers', label: 'Number of Tiers' })
      if (!(Number(barnBays) > 0)) list.push({ key: 'barnBays', label: 'Number of Bays' })
      if (!(Number(leavesPerString) > 0)) list.push({ key: 'leavesPerString', label: 'Leaves per String' })
    } else if (!(Number(damagedLeaves) > 0)) {
      list.push({ key: 'damagedLeaves', label: 'Number of Damaged Leaves' })
    }

    if (gpsLat === undefined || gpsLng === undefined) {
      list.push({ key: 'gps', label: 'GPS Coordinates', hint: 'press “Use Current Location” while on the farm.' })
    }
    if (!farmerPhotoCovered) list.push({ key: 'farmerPhoto', label: 'Farmer Photo' })
    if (!farmerSignature) list.push({ key: 'farmerSignature', label: 'Farmer Signature' })
    if (!assessorSignature) list.push({ key: 'assessorSignature', label: 'Assessor Signature' })
    return list
  }, [policyId, dateOfEvent, description, descriptionOfLoss, photosComplete, requiredPhotoCount,
    hectares, leavesAtTopping, isBarnFire, barnHooks, barnTiers, barnBays, leavesPerString, damagedLeaves,
    gpsLat, gpsLng, farmerPhotoCovered, farmerSignature, assessorSignature])

  /** Runs before the fraud declaration, so the assessor isn't asked to
   *  confirm a submission that was going to be refused anyway. */
  const handleAttemptSubmit = () => {
    setAttempted(true)
    if (missing.length > 0) {
      showToast?.('error', `Not submitted: ${missing.length} required ${missing.length === 1 ? 'field is' : 'fields are'} missing — ${missing.map(m => m.label).join(', ')}.`)
      scrollToField(missing[0].key)
      return
    }
    setShowFraudNotice(true)
  }

  const handleSave = async () => {
    if (missing.length > 0 || !policy || !user || saving) return
    setSaving(true)
    const dateSubmitted = new Date().toISOString().split('T')[0]
    const priorClaimsOnPolicy = allClaims.filter(c => c.policyId === policyId).length
    let fraudScore = 20
    let signals: string[] = []
    try {
      const result = await scoreClaimFraud({
        claimType, amount: Number(amount), coverAmount: policy.coverAmount,
        dateOfEvent, policyStartDate: policy.startDate, dateSubmitted, description, priorClaimsOnPolicy,
      })
      if (result.unavailable) {
        // fraud_score is NOT NULL, so the claim keeps the neutral baseline
        // above — but it is recorded as unscored rather than passed off as
        // a low-risk assessment nobody actually made. The agriculture
        // signals below still apply: they come from the physical evidence,
        // not the model, and they still raise the score.
        signals = ['Not risk-assessed by AI: scoring was unavailable when this claim was submitted.']
      } else {
        fraudScore = result.score
        signals = result.signals
      }

      // Agriculture-specific signals the generic text-based scorer above has
      // no visibility into — these come from the physical evidence actually
      // captured in this modal, so they're folded in here rather than
      // bolted on after the claim (and its fraudScore) already exist.
      const allCapturedPhotos = [...Object.values(photos).filter((p): p is AssessmentPhoto => !!p), ...(farmerSelfie ? [farmerSelfie] : [])]
      const flaggedCount = allCapturedPhotos.filter(p => p.aiFlagged).length
      const staleCount = allCapturedPhotos.filter(isPhotoStale).length
      if (flaggedCount > 0) {
        fraudScore = Math.min(100, fraudScore + flaggedCount * 15)
        signals.push(`${flaggedCount} submitted photo${flaggedCount !== 1 ? 's' : ''} flagged by AI review.`)
      }
      if (staleCount > 0) {
        fraudScore = Math.min(100, fraudScore + staleCount * 10)
        signals.push(`${staleCount} submitted photo${staleCount !== 1 ? 's are' : ' is'} more than 3 days old.`)
      }
      const { data: priorAssessments } = await db.policyAssessments.listForPolicy(policyId)
      if (priorAssessments.length === 0) {
        fraudScore = Math.min(100, fraudScore + 10)
        signals.push('No pre-loss assessment on record for this policy; crop/farm baseline unverified.')
      }

      // Duplicate/reused photo check — draftId can't match anything real yet
      // (the claim doesn't exist until db.claims.create below), so this is
      // purely a lookup against every OTHER claim/policy's photos. The hash
      // itself gets recorded post-creation, once the real claim id exists —
      // see handleAddAgriculture in Claims.tsx.
      const duplicateMatches: { photoLabel: string; reference: string; sourceType: string }[] = []
      for (const p of allCapturedPhotos) {
        if (!p.phash) continue
        const matches = await db.photoHashes.findMatches(p.phash, draftId)
        for (const m of matches) duplicateMatches.push({ photoLabel: p.label, reference: m.reference, sourceType: m.sourceType })
      }
      if (duplicateMatches.length > 0) {
        fraudScore = Math.min(100, fraudScore + duplicateMatches.length * 20)
        const examples = duplicateMatches.slice(0, 3).map(m => `"${m.photoLabel}" matches a photo on ${m.sourceType} ${m.reference}`).join('; ')
        signals.push(`${duplicateMatches.length} submitted photo${duplicateMatches.length !== 1 ? 's appear' : ' appears'} to be reused from elsewhere: ${examples}.`)
      }
    } finally {
      const claimNumber = `CLM${new Date().getFullYear()}${String(Date.now()).slice(-3)}`
      const claim: Claim & { fraudSignals?: string[] } = {
        id: draftId,
        claimNumber,
        policyId,
        policyNumber: policy.policyNumber,
        clientId: policy.clientId,
        clientName: policy.clientName,
        productName: policy.productName,
        claimType,
        amount: Number(amount),
        status: 'pending',
        stage: 'intake',
        category: 'agriculture',
        agentId: policy.agentId,
        agentName: policy.agentName,
        dateOfEvent,
        dateSubmitted,
        description,
        fraudScore,
        documents: [],
        fraudSignals: signals,
      }

      const uploadedPhotos = Object.values(photos).filter((p): p is AssessmentPhoto => !!p)
      if (farmerSelfie) uploadedPhotos.push(farmerSelfie)

      const offlinePhotos: PendingOfflinePhoto[] = await Promise.all(offlinePending.map(async ({ label, file, exifDate }) => ({
        label, base64: await fileToBase64(file), mediaType: file.type, fileName: file.name, exifDate, capturedAt: new Date().toISOString(),
      })))

      await onSave(claim, {
        assessorId: user.id,
        descriptionOfLoss,
        photos: uploadedPhotos,
        assessorComments,
        farmerStatement,
        gpsLat, gpsLng, cropPopulation, cropStage, barnCapacity,
        // Inputs and derived figures are stored together so a historical
        // claim stays reconcilable even if the standards or rates change.
        hectares: Number(hectares) || undefined,
        leavesExpected: leavesExpected || undefined,
        damagedLeaves: isBarnFire ? undefined : Number(damagedLeaves) || undefined,
        barnStrings: isBarnFire ? barnStrings || undefined : undefined,
        leavesPerString: isBarnFire ? Number(leavesPerString) || undefined : undefined,
        leavesLost: isBarnFire ? barnLeafCount || undefined : undefined,
        percentageLoss: claimCalc.percentageLoss,
        grossLoss: claimCalc.grossLoss,
        handlingExpenses: claimCalc.handlingExpenses,
        excessAmount: claimCalc.excess,
        claimPayable: claimCalc.claimPayable,
        farmerSignature, assessorSignature, farmerSelfie: farmerSelfie?.path,
        submittedAt: new Date().toISOString(),
        syncStatus: 'synced',
      }, offlinePhotos)
      setSaving(false)
    }
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <h3>New Agriculture Claim</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {onSwitchKind && (
            <div className="form-group">
              <div className="bubble-toggle">
                <button type="button" className={`bubble-toggle-btn${claimKind === 'ordinary' ? ' active' : ''}`} onClick={() => onSwitchKind('ordinary')}>Ordinary Claims</button>
                <button type="button" className={`bubble-toggle-btn${claimKind === 'agriculture' ? ' active' : ''}`} onClick={() => onSwitchKind('agriculture')}>Agriculture Claims</button>
              </div>
            </div>
          )}

          <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
            Agriculture claims capture the full physical assessment now: at least 6 damage photos, GPS, and both signatures are required before this can be submitted. Photos must be no more than 3 days old, checked automatically from each photo's date metadata.
          </div>

          <ValidationSummary missing={missing} attempted={attempted} />

          <div className="form-group" id={fieldId('policyNumber')}>
            <label>Policy Number *</label>
            <input
              className={invalidClass(missing, attempted, 'policyNumber')}
              list="ag-claim-policy-numbers"
              placeholder={loading ? 'Loading policies…' : 'Enter or select an agriculture policy number'}
              value={policyNumberInput}
              onChange={e => setPolicyNumberInput(e.target.value)}
              disabled={loading}
            />
            <datalist id="ag-claim-policy-numbers">
              {agriculturePolicies.map(p => <option key={p.id} value={p.policyNumber} />)}
            </datalist>
          </div>
          {policyNumberInput.trim() && !policy && !loading && (
            <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
              No agriculture policy found with that number.
            </div>
          )}
          {policy && (
            <>
              <div className="form-row">
                <div className="form-group">
                  <label>Client Name</label>
                  <input className="form-control" value={policy.clientName} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>National ID</label>
                  <input className="form-control" value={client?.nationalId ?? '—'} disabled style={{ opacity: 0.6 }} />
                </div>
              </div>
              <div className="form-row">
                <div className="form-group">
                  <label>Product / Package</label>
                  <input className="form-control" value={policy.productName} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-group">
                  <label>Max Cover</label>
                  <input className="form-control" value={`$${policy.coverAmount.toLocaleString()}`} disabled style={{ opacity: 0.6 }} />
                </div>
              </div>
            </>
          )}

          <div className="form-row">
            <div className="form-group">
              <label>Claim Type *</label>
              <select className="form-control" value={claimType} onChange={e => setClaimType(e.target.value)}>
                {CLAIM_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Claim Amount ($)</label>
              {/* Always the assessed payable figure from the Loss Assessment
                  below — never the sum insured, and never typed in. */}
              <input className="form-control" value={calcReady ? formatMoney(claimCalc.claimPayable) : '—'} disabled style={{ opacity: 0.6 }} />
              <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                Worked out from the leaf counts below.
              </span>
            </div>
          </div>
          <div className="form-group" id={fieldId('dateOfEvent')}>
            <label>Date of Event *</label>
            <div className={isMissing(missing, attempted, 'dateOfEvent') ? 'field-invalid-block' : undefined}>
              <DateInput value={dateOfEvent} onChange={setDateOfEvent} />
            </div>
          </div>
          <div className="form-group" id={fieldId('description')}>
            <label>Description *</label>
            <textarea className={invalidClass(missing, attempted, 'description')} rows={3} value={description} onChange={e => setDescription(e.target.value)} placeholder="Describe the incident…" />
          </div>
          <div className="form-group">
            <label>Status</label>
            <input className="form-control" value="Pending" disabled style={{ opacity: 0.6 }} />
          </div>

          <hr style={{ margin: '1.25rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />
          <h4 style={{ marginBottom: 10 }}>Physical Assessment</h4>

          <div className="form-group" id={fieldId('descriptionOfLoss')}>
            <label>Description of Loss *</label>
            <textarea className={invalidClass(missing, attempted, 'descriptionOfLoss')} rows={3} value={descriptionOfLoss} onChange={e => setDescriptionOfLoss(e.target.value)} placeholder="What the assessor observed on site…" />
          </div>

          <div className="form-group">
            <label>Farmer's Statement</label>
            <textarea className="form-control" rows={3} value={farmerStatement} onChange={e => setFarmerStatement(e.target.value)} placeholder="Summarize, in your own words, what the farmer told you on site, kept separate from your own remarks below." />
          </div>

          <label id={fieldId('photos')} style={{ display: 'block', margin: '1rem 0 6px', fontSize: 13, fontWeight: 600, color: isMissing(missing, attempted, 'photos') ? 'var(--danger)' : undefined }}>
            Damage / Loss Photos ({requiredPhotoCount}/{REQUIRED_PHOTO_SLOTS.length} required)
          </label>
          {allSlots.map(slot => (
            <div key={slot} style={{ position: 'relative' }}>
              <PhotoCaptureField
                label={slot}
                folder="claims"
                recordId={draftId}
                claimDescription={description}
                value={photos[slot]}
                onChange={p => setPhotos(prev => ({ ...prev, [slot]: p }))}
                onOfflineCapture={handleOfflineCapture}
                invalid={attempted && !photosComplete && REQUIRED_PHOTO_SLOTS.includes(slot) && !isSlotCovered(slot)}
              />
              {offlinePending.some(p => p.label === slot) && (
                <div style={{ fontSize: 11, color: 'var(--gold)', margin: '-8px 0 8px' }}>📴 Saved offline, will upload once you're back online.</div>
              )}
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
            + Add More Images (up to {MAX_PHOTOS})
          </button>

          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Assessor's Report / Comments</label>
            <textarea className="form-control" rows={3} value={assessorComments} onChange={e => setAssessorComments(e.target.value)} placeholder="Your analysis of the damage and evidence…" />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Crop Population</label>
              <input className="form-control" value={cropPopulation} onChange={e => setCropPopulation(e.target.value)} placeholder="e.g. 15000 plants/ha" />
              {baselineCropPopulation ? (
                <span style={{ fontSize: 11, color: cropPopulation.trim() === baselineCropPopulation ? 'var(--muted)' : 'var(--gold)', marginTop: 4, display: 'block' }}>
                  {cropPopulation.trim() === baselineCropPopulation
                    ? `Carried over from the pre-loss assessment (${baselineCropPopulation}).`
                    : `Differs from the pre-loss baseline of ${baselineCropPopulation}; explain the change in your comments.`}
                </span>
              ) : policyId ? (
                <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                  No crop population recorded at pre-loss for this policy.
                </span>
              ) : null}
            </div>
            <div className="form-group">
              <label>Crop Stage</label>
              <input className="form-control" value={cropStage} onChange={e => setCropStage(e.target.value)} placeholder="e.g. Tobacco, leaf stage" />
            </div>
          </div>
          <div className="form-group">
            <label>Barn Capacity</label>
            <input className="form-control" value={barnCapacity} onChange={e => setBarnCapacity(e.target.value)} placeholder="e.g. 12 tonnes" />
          </div>

          <hr style={{ margin: '1.25rem 0', border: 'none', borderTop: '1px solid var(--border)' }} />
          <h4 style={{ marginBottom: 4 }}>Loss Assessment</h4>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 0, marginBottom: 12 }}>
            Count the leaves; the percentage and the payable amount are worked out from them and cannot be typed in.
            Plant population is taken as {PLANTS_PER_HECTARE.toLocaleString()} per hectare; the leaves at topping are counted in the field.
          </p>

          <div className="form-row">
            <div className="form-group" id={fieldId('hectares')}>
              <label>Hectares Under Crop *</label>
              <input type="number" className={invalidClass(missing, attempted, 'hectares')} min={0} step="0.01" value={hectares} onChange={e => setHectares(e.target.value)} placeholder="e.g. 1.5" />
            </div>
            <div className="form-group" id={fieldId('leavesAtTopping')}>
              <label>Leaves at Topping (counted, per plant) *</label>
              <input type="number" className={invalidClass(missing, attempted, 'leavesAtTopping')} min={0} value={leavesAtTopping} onChange={e => setLeavesAtTopping(e.target.value)} placeholder={`Typically ${TYPICAL_LEAVES_AT_TOPPING}`} />
              <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                Counted in the field. {TYPICAL_LEAVES_AT_TOPPING} is typical, but this varies by variety and season.
              </span>
            </div>
          </div>

          <div className="form-group">
            <label>Total Leaves Expected After Topping</label>
            <input className="form-control" value={leavesExpected ? leavesExpected.toLocaleString() : '—'} disabled style={{ opacity: 0.6 }} />
            {leavesExpected > 0 && (
              <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                {hectares} ha × {PLANTS_PER_HECTARE.toLocaleString()} plants × {leavesAtTopping} leaves = {leavesExpected.toLocaleString()}
              </span>
            )}
          </div>

          {isBarnFire ? (
            <>
              <label style={{ display: 'block', margin: '1rem 0 6px', fontSize: 13, fontWeight: 600 }}>
                Barn Capacity
                {barnFromPreLoss && <span style={{ fontWeight: 400, color: 'var(--teal)', fontSize: 11 }}> · carried over from the pre-loss assessment</span>}
              </label>
              <div className="form-row">
                <div className="form-group" id={fieldId('barnHooks')}>
                  <label>Number of Hooks *</label>
                  <input type="number" className={invalidClass(missing, attempted, 'barnHooks')} min={0} value={barnHooks} onChange={e => setBarnHooks(e.target.value)} placeholder="e.g. 150" />
                </div>
                <div className="form-group" id={fieldId('barnTiers')}>
                  <label>Number of Tiers *</label>
                  <input type="number" className={invalidClass(missing, attempted, 'barnTiers')} min={0} value={barnTiers} onChange={e => setBarnTiers(e.target.value)} placeholder="e.g. 4" />
                </div>
                <div className="form-group" id={fieldId('barnBays')}>
                  <label>Number of Bays *</label>
                  <input type="number" className={invalidClass(missing, attempted, 'barnBays')} min={0} value={barnBays} onChange={e => setBarnBays(e.target.value)} placeholder="e.g. 3" />
                </div>
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Number of Strings</label>
                  <input className="form-control" value={barnStrings ? barnStrings.toLocaleString() : '—'} disabled style={{ opacity: 0.6 }} />
                  {barnStrings > 0 && (
                    <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                      {barnHooks} hooks × {barnTiers} tiers × {barnBays} bays
                    </span>
                  )}
                </div>
                <div className="form-group" id={fieldId('leavesPerString')}>
                  <label>Leaves per String *</label>
                  <input type="number" className={invalidClass(missing, attempted, 'leavesPerString')} min={0} value={leavesPerString} onChange={e => setLeavesPerString(e.target.value)} placeholder="e.g. 30" />
                </div>
              </div>

              <div className="form-group">
                <label>Total Leaves in the Barn (lost to the fire)</label>
                <input className="form-control" value={barnLeafCount ? barnLeafCount.toLocaleString() : '—'} disabled style={{ opacity: 0.6 }} />
                {barnLeafCount > 0 && (
                  <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                    {barnStrings.toLocaleString()} strings × {leavesPerString} leaves per string
                  </span>
                )}
              </div>
            </>
          ) : (
            <div className="form-group" id={fieldId('damagedLeaves')}>
              <label>Number of Damaged Leaves *</label>
              <input type="number" className={invalidClass(missing, attempted, 'damagedLeaves')} min={0} value={damagedLeaves} onChange={e => setDamagedLeaves(e.target.value)} placeholder="Leaves damaged in the field" />
            </div>
          )}

          {/* Everything below is derived from the counts above and locked, so
              the payable figure can only ever be what the formula produces. */}
          <h4 style={{ margin: '1.25rem 0 4px' }}>Claim Calculation</h4>
          <p style={{ fontSize: 11, color: 'var(--muted)', margin: '0 0 10px' }}>
            {calcReady
              ? 'Calculated from the counts above. These fields cannot be edited.'
              : 'Fills in automatically once the leaf counts and a policy are entered.'}
          </p>

          <div className="form-row">
            <div className="form-group">
              <label>Percentage Loss</label>
              <input
                className="form-control"
                value={calcReady ? formatPercent(claimCalc.percentageLoss) : '—'}
                disabled
                style={{ opacity: 0.6 }}
              />
              {calcReady && (
                <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                  {lossAssessment.leavesLost.toLocaleString()} damaged ÷ {lossAssessment.leavesExpected.toLocaleString()} at topping × 100
                </span>
              )}
            </div>
            <div className="form-group">
              <label>Loss in Monetary Value (Claim Amount)</label>
              <input
                className="form-control"
                value={calcReady ? formatMoney(claimCalc.grossLoss) : '—'}
                disabled
                style={{ opacity: 0.6 }}
              />
              {calcReady && (
                <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                  {formatPercent(claimCalc.percentageLoss)} × {formatMoney(policy?.coverAmount ?? 0)} sum insured
                </span>
              )}
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Less Handling Expenses (10%)</label>
              <input
                className="form-control"
                value={calcReady ? `- ${formatMoney(claimCalc.handlingExpenses)}` : '—'}
                disabled
                style={{ opacity: 0.6 }}
              />
            </div>
            <div className="form-group">
              <label>Less Excess (15%)</label>
              <input
                className="form-control"
                value={calcReady ? `- ${formatMoney(claimCalc.excess)}` : '—'}
                disabled
                style={{ opacity: 0.6 }}
              />
            </div>
          </div>

          <div className="form-group">
            <label style={{ fontWeight: 700 }}>Claim Payable</label>
            <input
              className="form-control"
              value={calcReady ? formatMoney(claimCalc.claimPayable) : '—'}
              disabled
              style={{ opacity: 0.85, fontWeight: 700, color: 'var(--teal)', background: 'var(--surface2)' }}
            />
            {calcReady && (
              <span style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4, display: 'block' }}>
                {formatMoney(claimCalc.grossLoss)} less {formatMoney(claimCalc.handlingExpenses)} handling and {formatMoney(claimCalc.excess)} excess. This is the amount the claim is submitted for.
              </span>
            )}
          </div>

          <div className={`form-group${isMissing(missing, attempted, 'gps') ? ' field-invalid-block' : ''}`} id={fieldId('gps')} style={{ marginTop: '1rem' }}>
            <label>GPS Coordinates *</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <button type="button" className="btn btn-outline btn-sm" disabled={gpsBusy} onClick={captureGps}>📍 {gpsBusy ? 'Getting location…' : 'Use Current Location'}</button>
              {gpsLat !== undefined && gpsLng !== undefined && (
                <span style={{ fontSize: 12, color: 'var(--muted)' }}>{gpsLat.toFixed(6)}, {gpsLng.toFixed(6)}</span>
              )}
            </div>
          </div>

          <div className="form-group" id={fieldId('farmerPhoto')}>
            <label>Farmer Photo *</label>
            <PhotoCaptureField label="Farmer Photo" folder="claims" recordId={draftId} value={farmerSelfie} onChange={setFarmerSelfie} onOfflineCapture={handleOfflineCapture} invalid={isMissing(missing, attempted, 'farmerPhoto')} />
            {offlinePending.some(p => p.label === 'Farmer Photo') && (
              <div style={{ fontSize: 11, color: 'var(--gold)', marginTop: 4 }}>📴 Saved offline, will upload once you're back online.</div>
            )}
          </div>

          <div className="form-row" style={{ marginTop: '1rem' }}>
            <div id={fieldId('farmerSignature')}>
              <SignaturePad label="Farmer Signature *" onChange={setFarmerSignature} invalid={isMissing(missing, attempted, 'farmerSignature')} />
            </div>
            <div id={fieldId('assessorSignature')}>
              <SignaturePad label="Assessor Signature *" onChange={setAssessorSignature} invalid={isMissing(missing, attempted, 'assessorSignature')} />
            </div>
          </div>
          <p style={{ fontSize: 11, color: 'var(--muted)', marginTop: 4 }}>Assessor: {user?.name}</p>

          <ValidationSummary missing={missing} attempted={attempted} />
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleAttemptSubmit} disabled={saving}>
            {saving ? 'Analysing & Submitting…' : 'Submit Agriculture Claim'}
          </button>
        </div>
      </div>
      {showFraudNotice && (
        <FraudNoticeModal
          confirming={saving}
          onCancel={() => setShowFraudNotice(false)}
          onConfirm={() => { setShowFraudNotice(false); void handleSave() }}
        />
      )}
    </div>
  )
}
