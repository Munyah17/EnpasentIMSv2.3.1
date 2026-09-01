import { useState, useEffect } from 'react'
import type { Claim, AppUser, ClaimAssessment, PolicyAssessment } from '../../types'
import { db } from '../../lib/db'
import { formatDate } from '../../lib/dateUtils'
import { getDocumentUrl, documentDisplayName } from '../../lib/storage'
import { reverseGeocode } from '../../lib/geocode'
import { useAuth } from '../../contexts/AuthContext'
import {
  notifyClaimIntakeAccepted, notifyClaimIntakeRejected,
  notifyClaimEscalated, notifyClaimFinalDecision,
} from '../../lib/claimNotifications'
import AgricultureAssessmentModal from './AgricultureAssessmentModal'
import { exportClaimAssessmentReport } from '../../lib/exportUtils'
import { scoreClaimFraud } from '../../lib/aiService'

interface Props {
  claim: Claim
  onClose: () => void
  /** The modal resolves the whole transition (next claim state) itself —
   *  the parent just persists it and, on success, fires `notify`. */
  onSave: (claim: Claim, notify: () => Promise<void>) => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

const STAGE_LABEL: Record<Claim['stage'], string> = {
  intake: 'Intake: Claims Receiver',
  assessment: 'Assessment: Claims Processor',
  final_review: 'Final Review: MD/COO',
  closed: 'Closed',
}

const isAgriculture = (claim: Claim) => claim.category === 'agriculture'

export default function ReviewClaimModal({ claim, onClose, onSave, showToast }: Props) {
  const { hasPermission } = useAuth()
  const [notes, setNotes] = useState(claim.notes ?? '')
  const [assessmentNotes, setAssessmentNotes] = useState(claim.assessmentNotes ?? '')
  const [nextStaffId, setNextStaffId] = useState('')
  const [staff, setStaff] = useState<AppUser[]>([])
  const [busy, setBusy] = useState(false)
  const [physicalAssessments, setPhysicalAssessments] = useState<ClaimAssessment[]>([])
  const [showAssessmentModal, setShowAssessmentModal] = useState(false)
  const [preLossAssessments, setPreLossAssessments] = useState<PolicyAssessment[]>([])
  // score is null when the model could not be reached. That is shown as
  // "unavailable", never as a number — a placeholder score sitting next to
  // the claim's real one reads as the AI disagreeing with it.
  const [aiInsights, setAiInsights] = useState<{ insights: string[]; reasoning: string; score: number | null } | null>(null)
  const [aiLoading, setAiLoading] = useState(false)
  const [postLossPhotoUrls, setPostLossPhotoUrls] = useState<Record<string, string>>({})
  const [postLossPlaceLabel, setPostLossPlaceLabel] = useState<string | null>(null)

  useEffect(() => {
    db.staff.list().then(({ data }) => { if (data) setStaff(data.filter(u => u.active)) })
    if (isAgriculture(claim)) {
      db.claimAssessments.listForClaim(claim.id).then(({ data }) => setPhysicalAssessments(data))
    }
    db.policyAssessments.listForPolicy(claim.policyId).then(({ data }) => setPreLossAssessments(data))
  }, [claim])

  const hasCompletedAssessment = physicalAssessments.some(a => !!a.submittedAt)
  const preLoss = preLossAssessments[0]
  const postLoss = physicalAssessments.find(a => !!a.submittedAt)

  useEffect(() => {
    if (!postLoss || postLoss.photos.length === 0) { setPostLossPhotoUrls({}); return }
    let cancelled = false
    Promise.all(postLoss.photos.map(async p => [p.path, await getDocumentUrl(p.path)] as const)).then(pairs => {
      if (cancelled) return
      const urls: Record<string, string> = {}
      pairs.forEach(([path, url]) => { if (url) urls[path] = url })
      setPostLossPhotoUrls(urls)
    })
    return () => { cancelled = true }
  }, [postLoss])

  useEffect(() => {
    if (!postLoss || postLoss.gpsLat === undefined || postLoss.gpsLng === undefined) { setPostLossPlaceLabel(null); return }
    let cancelled = false
    setPostLossPlaceLabel(null)
    reverseGeocode(postLoss.gpsLat, postLoss.gpsLng).then(label => { if (!cancelled) setPostLossPlaceLabel(label) })
    return () => { cancelled = true }
  }, [postLoss])

  const getAiInsights = async () => {
    setAiLoading(true)
    setAiInsights(null)
    try {
      const [{ data: policy }, { data: allClaims }] = await Promise.all([db.policies.get(claim.policyId), db.claims.list()])
      const priorClaimsOnPolicy = (allClaims ?? []).filter(c => c.policyId === claim.policyId && c.id !== claim.id).length
      const result = await scoreClaimFraud({
        claimType: claim.claimType, amount: claim.amount, coverAmount: policy?.coverAmount ?? claim.amount,
        dateOfEvent: claim.dateOfEvent, policyStartDate: policy?.startDate ?? claim.dateSubmitted, dateSubmitted: claim.dateSubmitted,
        description: claim.description, priorClaimsOnPolicy,
        preLossAssessment: preLoss ? {
          subjectType: preLoss.subjectType,
          cropType: preLoss.cropType, cropPopulation: preLoss.cropPopulation,
          registrationNumber: preLoss.registrationNumber,
          vehicleMakeModel: [preLoss.vehicleMake, preLoss.vehicleModel].filter(Boolean).join(' ') || undefined,
          existingDamage: preLoss.existingDamage, recordedAt: formatDate(preLoss.createdAt),
        } : undefined,
        postLossAssessment: postLoss ? {
          descriptionOfLoss: postLoss.descriptionOfLoss, farmerStatement: postLoss.farmerStatement,
          assessorComments: postLoss.assessorComments, cropStage: postLoss.cropStage,
        } : undefined,
      })
      setAiInsights({ insights: result.insights, reasoning: result.reasoning, score: result.score })
    } catch {
      setAiInsights({ insights: [], reasoning: 'AI fraud scoring could not be reached, so no AI score was produced.', score: null })
    } finally {
      setAiLoading(false)
    }
  }

  const printAssessment = () => {
    const completed = physicalAssessments.find(a => !!a.submittedAt)
    if (completed) void exportClaimAssessmentReport(completed, claim.claimNumber, claim.policyNumber, claim.clientName)
  }

  const scoreColor = claim.fraudScore >= 70 ? 'var(--danger)' : claim.fraudScore >= 40 ? 'var(--gold)' : 'var(--teal)'

  const openDocument = async (path: string) => {
    const url = await getDocumentUrl(path)
    if (url) window.open(url, '_blank', 'noopener,noreferrer')
  }

  const describeDocument = (path: string) => {
    const raw = documentDisplayName(path)
    const [label, ...rest] = raw.split('_')
    return rest.length ? `${label.replace(/-/g, ' ')}: ${rest.join('_')}` : raw
  }

  const saveNotesOnly = () => {
    onSave({ ...claim, notes }, async () => { /* internal note edit — nothing to notify */ })
  }

  const acceptIntake = async () => {
    const processor = staff.find(s => s.id === nextStaffId)
    if (!processor) return
    setBusy(true)
    const updated: Claim = { ...claim, notes, stage: 'assessment', status: 'under_review', assignedTo: processor.id, assignedName: processor.name }
    onSave(updated, () => notifyClaimIntakeAccepted(updated, { email: processor.email, phone: processor.phone, name: processor.name }))
  }

  const rejectIntake = () => {
    setBusy(true)
    const updated: Claim = { ...claim, notes, stage: 'closed', status: 'rejected', resolvedAt: new Date().toISOString() }
    onSave(updated, () => notifyClaimIntakeRejected(updated))
  }

  const escalateToFinalReview = () => {
    const reviewer = staff.find(s => s.id === nextStaffId)
    if (!reviewer) return
    setBusy(true)
    const updated: Claim = { ...claim, notes, assessmentNotes, stage: 'final_review', assignedTo: reviewer.id, assignedName: reviewer.name }
    onSave(updated, () => notifyClaimEscalated(updated, { email: reviewer.email, phone: reviewer.phone, name: reviewer.name }))
  }

  const finalDecision = (approve: boolean) => {
    setBusy(true)
    const updated: Claim = { ...claim, notes, stage: 'closed', status: approve ? 'approved' : 'rejected', resolvedAt: new Date().toISOString() }
    onSave(updated, () => notifyClaimFinalDecision(updated))
  }

  return (
    <div className="modal-overlay">
      <div className="modal">
        <div className="modal-header">
          <h3>Review Claim: {claim.claimNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          {claim.fraudScore >= 40 && (
            <div className={`info-banner info-banner-${claim.fraudScore >= 70 ? 'danger' : 'warning'}`} style={{ marginBottom: '1rem' }}>
              ⚠ Fraud score: <strong>{claim.fraudScore}%</strong>: {claim.fraudScore >= 70 ? 'HIGH RISK: Investigate before processing.' : 'Moderate risk: Verify documents carefully.'}
            </div>
          )}
          <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
            Stage: <strong>{STAGE_LABEL[claim.stage]}</strong>
            {claim.assignedName && claim.stage !== 'closed' && <> · assigned to <strong>{claim.assignedName}</strong></>}
          </div>
          <div className="detail-grid">
            <div className="detail-item"><span className="detail-label">Client</span><span>{claim.clientName}</span></div>
            <div className="detail-item"><span className="detail-label">Policy</span><span className="mono">{claim.policyNumber}</span></div>
            <div className="detail-item"><span className="detail-label">Product</span><span>{claim.productName}</span></div>
            <div className="detail-item"><span className="detail-label">Type</span><span>{claim.claimType}</span></div>
            <div className="detail-item"><span className="detail-label">Amount</span><span>${claim.amount.toLocaleString()}</span></div>
            <div className="detail-item"><span className="detail-label">Date of Event</span><span>{formatDate(claim.dateOfEvent)}</span></div>
            <div className="detail-item"><span className="detail-label">Submitted</span><span>{formatDate(claim.dateSubmitted)}</span></div>
            <div className="detail-item">
              <span className="detail-label">Fraud Score</span>
              <span style={{ color: scoreColor, fontWeight: 600 }}>{claim.fraudScore}%</span>
            </div>
          </div>
          <div className="form-group" style={{ marginTop: '1rem' }}>
            <label>Description</label>
            <p style={{ color: 'var(--text)', fontSize: '0.9rem', lineHeight: 1.6 }}>{claim.description}</p>
          </div>
          {claim.documents.length > 0 && (
            <div className="form-group">
              <label>Supporting Documents</label>
              <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 4 }}>
                {claim.documents.map(path => (
                  <li key={path}>
                    <button type="button" onClick={() => openDocument(path)} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--blue)', textDecoration: 'underline', cursor: 'pointer', fontSize: 12 }}>
                      📄 {describeDocument(path)}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {preLoss && (
            <div className="form-group">
              <label>📷 Pre-Loss Assessment on File, recorded {formatDate(preLoss.createdAt)} by {preLoss.assessorName || 'an assessor'}</label>
              <div className="detail-grid" style={{ marginTop: 4 }}>
                {preLoss.subjectType === 'vehicle' ? (
                  <>
                    <div className="detail-item"><span className="detail-label">Registration</span><span>{preLoss.registrationNumber || '—'}</span></div>
                    <div className="detail-item"><span className="detail-label">Vehicle</span><span>{[preLoss.vehicleMake, preLoss.vehicleModel].filter(Boolean).join(' ') || '—'}</span></div>
                    <div className="detail-item"><span className="detail-label">Existing Damage Noted</span><span>{preLoss.existingDamage || 'None noted'}</span></div>
                  </>
                ) : (
                  <>
                    <div className="detail-item"><span className="detail-label">Crop Recorded</span><span>{preLoss.cropType || '—'}</span></div>
                    <div className="detail-item"><span className="detail-label">Crop Population</span><span>{preLoss.cropPopulation || '—'}</span></div>
                    {(preLoss.barnHooks || preLoss.barnTiers || preLoss.barnBays) && (
                      <div className="detail-item">
                        <span className="detail-label">Barn Capacity Declared</span>
                        <span>
                          {[preLoss.barnHooks && `${preLoss.barnHooks} hooks`,
                            preLoss.barnTiers && `${preLoss.barnTiers} tiers`,
                            preLoss.barnBays && `${preLoss.barnBays} bays`].filter(Boolean).join(' · ')}
                        </span>
                      </div>
                    )}
                    {(preLoss.barnOwnership || preLoss.barnUsage) && (
                      <div className="detail-item">
                        <span className="detail-label">Barn Declared As</span>
                        <span>{[preLoss.barnOwnership, preLoss.barnUsage].filter(Boolean).join(' · ')}</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>
          )}
          {!preLoss && (claim.category === 'agriculture' || claim.category === 'motor') && (
            <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
              ⚠ No pre-loss assessment is on file for this policy; the condition before this claim was never independently recorded.
            </div>
          )}

          {/* Visible at every stage (not just while stage === 'assessment')
             so the Final Reviewer / Super Admin can actually see the
             evidence before deciding, not just a "Completed" label -- the
             print-only PDF was the only way to see this before. */}
          {postLoss && (
            <div className="form-group">
              <label>🔎 Physical Assessment Evidence, submitted {formatDate(postLoss.submittedAt)} by {postLoss.assessorName}</label>
              <div className="detail-grid" style={{ marginTop: 4 }}>
                <div className="detail-item"><span className="detail-label">Description of Loss</span><span>{postLoss.descriptionOfLoss || '—'}</span></div>
                <div className="detail-item">
                  <span className="detail-label">GPS Coordinates</span>
                  <span>
                    {postLoss.gpsLat !== undefined && postLoss.gpsLng !== undefined
                      ? `${postLoss.gpsLat.toFixed(6)}, ${postLoss.gpsLng.toFixed(6)}${postLossPlaceLabel ? ` (${postLossPlaceLabel})` : ''}`
                      : 'Not captured'}
                  </span>
                </div>
              </div>
              {postLoss.assessorComments && (
                <p style={{ fontSize: '0.85rem', color: 'var(--text)', marginTop: 6 }}>{postLoss.assessorComments}</p>
              )}
              {postLoss.photos.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600 }}>Photos ({postLoss.photos.length})</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
                    {postLoss.photos.map((p, i) => (
                      <a key={i} href={postLossPhotoUrls[p.path]} target="_blank" rel="noopener noreferrer" style={{ pointerEvents: postLossPhotoUrls[p.path] ? 'auto' : 'none' }} title="Open full size">
                        {postLossPhotoUrls[p.path] ? (
                          <img src={postLossPhotoUrls[p.path]} alt={p.label} style={{ width: 90, height: 68, objectFit: 'cover', borderRadius: 6, border: '1px solid var(--border)', display: 'block' }} />
                        ) : (
                          <div style={{ width: 90, height: 68, borderRadius: 6, border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--muted)' }}>Loading…</div>
                        )}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {(postLoss.farmerSignature || postLoss.assessorSignature) && (
                <div style={{ display: 'flex', gap: 16, marginTop: 8 }}>
                  {postLoss.farmerSignature && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Farmer Signature</span>
                      <img src={postLoss.farmerSignature} alt="Farmer signature" style={{ width: 120, height: 40, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 4, background: '#fff' }} />
                    </div>
                  )}
                  {postLoss.assessorSignature && (
                    <div>
                      <span style={{ fontSize: 11, color: 'var(--muted)', display: 'block' }}>Assessor Signature</span>
                      <img src={postLoss.assessorSignature} alt="Assessor signature" style={{ width: 120, height: 40, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 4, background: '#fff' }} />
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          <div className="form-group">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <label style={{ margin: 0 }}>🤖 AI Insights &amp; Fraud Analysis</label>
              <button type="button" className="btn btn-outline btn-sm" disabled={aiLoading} onClick={getAiInsights}>
                {aiLoading ? 'Analyzing…' : aiInsights ? 'Re-run Analysis' : 'Get AI Insights'}
              </button>
            </div>
            {aiInsights && (
              <div className={`info-banner ${aiInsights.score === null ? 'info-banner-warning' : 'info-banner-info'}`} style={{ marginTop: 8 }}>
                {aiInsights.score === null ? (
                  <>
                    {/* No score is not a low score. Showing a placeholder
                        number here put "AI Fraud Score: 20%" and "No
                        specific concerns identified" directly beneath a
                        claim flagged at 95% HIGH RISK, which reads as the
                        AI having cleared it. */}
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>AI Fraud Score: unavailable</div>
                    <p style={{ fontSize: 12, margin: '4px 0 0' }}>{aiInsights.reasoning}</p>
                    <p style={{ fontSize: 12, margin: '4px 0 0' }}>
                      The claim's own score of <strong>{claim.fraudScore}%</strong> still stands; nothing here changes it.
                    </p>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600, marginBottom: 4 }}>
                      AI Fraud Score: <span style={{ color: aiInsights.score >= 70 ? 'var(--danger)' : aiInsights.score >= 40 ? 'var(--gold)' : 'var(--teal)' }}>{aiInsights.score}%</span>
                    </div>
                    {aiInsights.insights.length > 0 ? (
                      <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 12 }}>
                        {aiInsights.insights.map((ins, i) => <li key={i}>{ins}</li>)}
                      </ul>
                    ) : (
                      <p style={{ fontSize: 12, margin: '4px 0 0' }}>No specific concerns identified.</p>
                    )}
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '6px 0 0' }}>{aiInsights.reasoning}</p>
                    <p style={{ fontSize: 11, color: 'var(--muted)', margin: '4px 0 0', fontStyle: 'italic' }}>This is decision support only; the final call always rests with the reviewer.</p>
                  </>
                )}
              </div>
            )}
          </div>

          {claim.assessmentNotes && claim.stage !== 'assessment' && (
            <div className="form-group">
              <label>Assessment Notes</label>
              <p style={{ color: 'var(--text)', fontSize: '0.85rem', lineHeight: 1.6 }}>{claim.assessmentNotes}</p>
            </div>
          )}

          <div className="form-group">
            <label>Internal Notes</label>
            <textarea className="form-control" rows={3} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Add review notes…" />
          </div>

          {/* ── Stage-specific action area ─────────────────────────── */}
          {claim.stage === 'intake' && hasPermission('claims.intake') && (
            <div className="claim-stage-action">
              <label>Accept &amp; Assign to Claims Processor</label>
              <select className="form-control" value={nextStaffId} onChange={e => setNextStaffId(e.target.value)}>
                <option value="">Select processor…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role.replace(/_/g, ' ')})</option>)}
              </select>
              <div className="claim-stage-action-btns">
                <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={rejectIntake}>Reject Claim</button>
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !nextStaffId} onClick={acceptIntake}>Accept &amp; Assign</button>
              </div>
            </div>
          )}

          {claim.stage === 'assessment' && isAgriculture(claim) && (
            <div className="claim-stage-action">
              <label>Physical Assessment {hasCompletedAssessment ? '✓ Completed' : '(required before final review)'}</label>
              {hasCompletedAssessment ? (
                <p style={{ fontSize: 12, color: 'var(--success)' }}>
                  Submitted {formatDate(physicalAssessments.find(a => a.submittedAt)?.submittedAt)} by {physicalAssessments.find(a => a.submittedAt)?.assessorName}.
                </p>
              ) : (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>An Assessor must complete a site visit before this claim can go to final review.</p>
              )}
              <div className="claim-stage-action-btns">
                {hasCompletedAssessment && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={printAssessment}>🖨 Print Assessment</button>
                )}
                {hasPermission('claims.physical_assessment') && (
                  <button type="button" className="btn btn-outline btn-sm" onClick={() => setShowAssessmentModal(true)}>
                    {hasCompletedAssessment ? 'View / Redo Assessment' : '📷 Start Physical Assessment'}
                  </button>
                )}
              </div>
            </div>
          )}

          {claim.stage === 'assessment' && hasPermission('claims.assess') && (
            <div className="claim-stage-action">
              <label>Assessment Notes</label>
              <textarea className="form-control" rows={3} value={assessmentNotes} onChange={e => setAssessmentNotes(e.target.value)} placeholder="Record your analysis of this claim…" />
              <label style={{ marginTop: 8 }}>Escalate to Final Reviewer (MD/COO)</label>
              <select className="form-control" value={nextStaffId} onChange={e => setNextStaffId(e.target.value)}>
                <option value="">Select final reviewer…</option>
                {staff.map(s => <option key={s.id} value={s.id}>{s.name} ({s.role.replace(/_/g, ' ')})</option>)}
              </select>
              {isAgriculture(claim) && !hasCompletedAssessment && (
                <p style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>Complete the physical assessment above before escalating.</p>
              )}
              <div className="claim-stage-action-btns">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy || !nextStaffId || (isAgriculture(claim) && !hasCompletedAssessment)} onClick={escalateToFinalReview}>Submit for Final Review</button>
              </div>
            </div>
          )}

          {claim.stage === 'final_review' && (hasPermission('claims.approve') || hasPermission('claims.reject')) && (
            <div className="claim-stage-action">
              <label>Final Decision</label>
              <div className="claim-stage-action-btns">
                {hasPermission('claims.reject') && (
                  <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} disabled={busy} onClick={() => finalDecision(false)}>Decline</button>
                )}
                {hasPermission('claims.approve') && (
                  <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => finalDecision(true)}>Approve</button>
                )}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={saveNotesOnly} disabled={busy}>Save Notes</button>
        </div>
      </div>
      {showAssessmentModal && (
        <AgricultureAssessmentModal
          claimId={claim.id}
          claimNumber={claim.claimNumber}
          claimDescription={claim.description}
          baselineCropPopulation={preLoss?.cropPopulation?.trim() || undefined}
          onClose={() => setShowAssessmentModal(false)}
          onSubmitted={() => {
            setShowAssessmentModal(false)
            db.claimAssessments.listForClaim(claim.id).then(({ data }) => setPhysicalAssessments(data))
          }}
          showToast={showToast}
        />
      )}
    </div>
  )
}
