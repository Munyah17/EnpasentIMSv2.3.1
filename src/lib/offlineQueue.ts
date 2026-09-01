/**
 * Offline-first queue for assessment submissions. Assessors are often on
 * farms with no signal — this stores a fully-formed assessment (including
 * photos, as base64) in localStorage when the network isn't there, and
 * flushes the queue automatically the moment the browser comes back online.
 *
 * Known limitation: localStorage caps out around 5-10MB depending on the
 * browser, which is enough for a handful of queued photos but not
 * unlimited — this is a first version, not a guarantee for very large
 * batches. Test on a real device with airplane mode before relying on it
 * in the field for a big assessment (many high-res photos).
 */
import { db } from './db'
import { uploadDocument } from './storage'
import { analyzePhotoForFraud } from './photoAnalysis'
import { computePerceptualHash } from './photoHash'
import { checkAndRecordPhotoDuplicates } from './duplicatePhotoCheck'
import type { AssessmentPhoto } from '../types'

const QUEUE_KEY = 'tqfy_offline_assessment_queue'

interface QueuedPhoto {
  label: string
  base64: string
  mediaType: string
  fileName: string
  exifDate?: string
  capturedAt: string
}

interface QueuedAssessment {
  localId: string
  kind: 'claim' | 'policy'
  recordId: string
  /** Everything except photos — assessor comments, GPS, crop fields,
   *  signatures (already base64 PNGs from SignaturePad), etc. */
  formData: Record<string, unknown>
  pendingPhotos: QueuedPhoto[]
  queuedAt: string
}

function readQueue(): QueuedAssessment[] {
  try { return JSON.parse(localStorage.getItem(QUEUE_KEY) ?? '[]') } catch { return [] }
}

function writeQueue(queue: QueuedAssessment[]) {
  try { localStorage.setItem(QUEUE_KEY, JSON.stringify(queue)) } catch { /* storage full — best effort */ }
}

export function queueAssessment(kind: 'claim' | 'policy', recordId: string, formData: Record<string, unknown>, pendingPhotos: QueuedPhoto[]): void {
  const queue = readQueue()
  queue.push({ localId: `q${Date.now()}${Math.random().toString(36).slice(2, 6)}`, kind, recordId, formData, pendingPhotos, queuedAt: new Date().toISOString() })
  writeQueue(queue)
}

export function getQueueLength(): number {
  return readQueue().length
}

function base64ToFile(base64: string, mediaType: string, fileName: string): File {
  const bytes = atob(base64)
  const arr = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i)
  return new File([arr], fileName, { type: mediaType })
}

async function flushOne(item: QueuedAssessment): Promise<boolean> {
  // Photos that were already uploaded online before connectivity dropped
  // mid-assessment travel alongside the still-pending ones in formData.
  const uploaded: AssessmentPhoto[] = [...((item.formData._alreadyUploadedPhotos as AssessmentPhoto[] | undefined) ?? [])]
  for (const p of item.pendingPhotos) {
    const file = base64ToFile(p.base64, p.mediaType, p.fileName)
    const folder = item.kind === 'claim' ? 'claims' : 'policies'
    const { data, error } = await uploadDocument(folder, item.recordId, file)
    if (error || !data) return false // still offline or upload failed — try again next sync pass

    // Mirror what PhotoCaptureField does for an online capture — an
    // offline-captured photo must get the same AI fraud check and
    // duplicate-photo hash once it finally has connectivity to run them,
    // not silently skip fraud coverage forever just because it was taken
    // somewhere with poor signal.
    let visibleDateStamp: string | undefined
    let aiNote: string | undefined
    let aiFlagged = false
    try {
      const result = await analyzePhotoForFraud(p.base64, p.mediaType, p.label)
      if (!result.simulated) {
        visibleDateStamp = result.visibleDateStamp ?? undefined
        aiNote = result.note
        aiFlagged = !!result.flagged
      }
    } catch { /* AI check is best-effort — never block sync on it */ }
    const phash = await computePerceptualHash(file)

    uploaded.push({
      path: data.path, label: p.label, exifDate: p.exifDate, capturedAt: p.capturedAt,
      visibleDateStamp, aiNote, aiFlagged, phash: phash ?? undefined,
    })
  }

  if (item.kind === 'claim') {
    const { data, error } = await db.claimAssessments.create({
      claimId: item.recordId,
      assessorId: (item.formData.assessorId as string) ?? '',
      descriptionOfLoss: (item.formData.descriptionOfLoss as string) ?? '',
      photos: uploaded,
      assessorComments: (item.formData.assessorComments as string) ?? '',
      farmerStatement: item.formData.farmerStatement as string | undefined,
      gpsLat: item.formData.gpsLat as number | undefined,
      gpsLng: item.formData.gpsLng as number | undefined,
      cropPopulation: item.formData.cropPopulation as string | undefined,
      cropStage: item.formData.cropStage as string | undefined,
      barnCapacity: item.formData.barnCapacity as string | undefined,
      farmerSignature: item.formData.farmerSignature as string | undefined,
      assessorSignature: item.formData.assessorSignature as string | undefined,
      farmerSelfie: item.formData.farmerSelfie as string | undefined,
      submittedAt: new Date().toISOString(),
      syncStatus: 'synced',
    })
    if (error || !data) return false
    // Same duplicate/reused-photo check the online submit path runs
    // immediately — an offline-captured photo must still get indexed and
    // checked against everything else once it finally uploads.
    void checkAndRecordPhotoDuplicates(uploaded, 'claim', item.recordId, data.claimNumber || item.recordId)
  } else {
    const { data, error } = await db.policyAssessments.create({
      policyId: item.recordId,
      assessorId: (item.formData.assessorId as string) ?? '',
      subjectType: (item.formData.subjectType as 'agriculture' | 'vehicle') ?? 'agriculture',
      cropType: item.formData.cropType as string | undefined,
      cropPopulation: item.formData.cropPopulation as string | undefined,
      plantDate: item.formData.plantDate as string | undefined,
      registrationNumber: item.formData.registrationNumber as string | undefined,
      vehicleMake: item.formData.vehicleMake as string | undefined,
      vehicleModel: item.formData.vehicleModel as string | undefined,
      odometerReading: item.formData.odometerReading as string | undefined,
      existingDamage: item.formData.existingDamage as string | undefined,
      photos: uploaded,
      notes: (item.formData.notes as string) ?? '',
      gpsLat: item.formData.gpsLat as number | undefined,
      gpsLng: item.formData.gpsLng as number | undefined,
      barnHooks: item.formData.barnHooks as number | undefined,
      barnTiers: item.formData.barnTiers as number | undefined,
      barnBays: item.formData.barnBays as number | undefined,
      barnOwnership: item.formData.barnOwnership as string | undefined,
      barnUsage: item.formData.barnUsage as string | undefined,
      farmerSignature: item.formData.farmerSignature as string | undefined,
      assessorSignature: item.formData.assessorSignature as string | undefined,
      syncStatus: 'synced',
    })
    if (error || !data) return false
    void checkAndRecordPhotoDuplicates(uploaded, 'policy', item.recordId, data.policyNumber || item.recordId)
  }
  return true
}

let syncing = false

/** Attempts to flush every queued assessment. Safe to call repeatedly —
 *  guards against overlapping runs and only removes items that actually
 *  succeeded, leaving the rest queued for the next attempt. */
export async function syncOfflineQueue(): Promise<void> {
  if (syncing || !navigator.onLine) return
  syncing = true
  try {
    const queue = readQueue()
    if (queue.length === 0) return
    const remaining: QueuedAssessment[] = []
    for (const item of queue) {
      const ok = await flushOne(item)
      if (!ok) remaining.push(item)
    }
    writeQueue(remaining)
  } finally {
    syncing = false
  }
}

/** Call once at app startup — flushes on load (in case connectivity came
 *  back while the tab was closed) and again every time the browser
 *  reports it's back online. */
export function startOfflineSync(): () => void {
  void syncOfflineQueue()
  const onOnline = () => { void syncOfflineQueue() }
  window.addEventListener('online', onOnline)
  return () => window.removeEventListener('online', onOnline)
}
