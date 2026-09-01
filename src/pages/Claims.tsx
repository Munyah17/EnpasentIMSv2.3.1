import { useState, useEffect } from 'react'
import type { ToastMessage, Claim, ClaimStatus, ClaimAssessment } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import ScoreBar from '../components/ui/ScoreBar'
import NewClaimModal from '../components/modals/NewClaimModal'
import NewAgricultureClaimModal, { type PendingOfflinePhoto } from '../components/modals/NewAgricultureClaimModal'
import ReviewClaimModal from '../components/modals/ReviewClaimModal'
import { notifyClaimCreated } from '../lib/claimNotifications'
import { useAuth } from '../contexts/AuthContext'
import { queueAssessment } from '../lib/offlineQueue'
import { checkAndRecordPhotoDuplicates } from '../lib/duplicatePhotoCheck'
import { recordActivity } from '../lib/activityLog'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
  /** Claim category to narrow to on open, set when another page sends the
   *  user here for a specific book (e.g. Agriculture Insurance). */
  initialCategory?: string
}

export default function Claims({ showToast, initialCategory }: Props) {
  const { hasPermission, user } = useAuth()
  const [claims, setClaims] = useState<Claim[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<ClaimStatus | 'all'>('all')
  const [newClaimKind, setNewClaimKind] = useState<'ordinary' | 'agriculture' | null>(null)
  const [reviewClaim, setReviewClaim] = useState<Claim | null>(null)

  useEffect(() => {
    db.claims.list().then(({ data, error }) => {
      if (error) showToast('error', 'Failed to load claims.')
      else if (data) setClaims(data)
      setLoading(false)
    })
  }, [showToast])

  const filtered = claims.filter(c => {
    const q = search.toLowerCase()
    const matchSearch = c.claimNumber.toLowerCase().includes(q) ||
      c.clientName.toLowerCase().includes(q) ||
      (c.policyNumber ?? '').toLowerCase().includes(q)
    const matchStatus = statusFilter === 'all' || c.status === statusFilter
    const matchCategory = !initialCategory || c.category === initialCategory
    return matchSearch && matchStatus && matchCategory
  })

  const counts = {
    all: claims.length,
    pending: claims.filter(c => c.status === 'pending').length,
    under_review: claims.filter(c => c.status === 'under_review').length,
    approved: claims.filter(c => c.status === 'approved').length,
    rejected: claims.filter(c => c.status === 'rejected').length,
    paid: claims.filter(c => c.status === 'paid').length,
  }

  const finishClaimSubmission = async (data: Claim, fraudSignals: string[] | undefined) => {
    setClaims(prev => [data, ...prev])
    setNewClaimKind(null)
    try { notifyClaimCreated(data) } catch { /**/ }

    const FRAUD_REVIEW_THRESHOLD = 55
    if (data.fraudScore >= FRAUD_REVIEW_THRESHOLD) {
      await db.fraudCases.create(data.id, data.fraudScore, fraudSignals ?? [])
      showToast('warning', `Claim ${data.claimNumber} submitted, flagged for fraud review (score ${data.fraudScore}).`)
    } else {
      showToast('success', `Claim ${data.claimNumber} submitted successfully.`)
    }
  }

  const handleAdd = async (claim: Claim & { fraudSignals?: string[] }) => {
    const { data, error } = await db.claims.create(claim)
    if (error || !data) { showToast('error', 'Failed to submit claim.'); return }
    await finishClaimSubmission(data, claim.fraudSignals)
  }

  /** Agriculture claims capture the full physical assessment (photos, GPS,
   *  farmer + assessor signatures) at intake time in one modal rather than
   *  as a separate later step — the claim still starts at the normal
   *  'intake' stage and flows through assessment/final_review exactly like
   *  any other claim, but by the time it reaches the assessment stage the
   *  assessment is already there and complete (ReviewClaimModal's
   *  hasCompletedAssessment check picks it up automatically).
   *
   *  Any photos that couldn't upload while offline, or a failure attaching
   *  the assessment even when online, both fall back to the same
   *  offline-queue AgricultureAssessmentModal already uses — the claim
   *  itself is never left without its assessment silently. */
  const handleAddAgriculture = async (
    claim: Claim & { fraudSignals?: string[] },
    assessment: Omit<ClaimAssessment, 'id' | 'claimId' | 'claimNumber' | 'assessorName' | 'createdAt'>,
    offlinePhotos: PendingOfflinePhoto[],
  ) => {
    const { data, error } = await db.claims.create(claim)
    if (error || !data) { showToast('error', 'Failed to submit claim.'); return }

    const queueFallback = () => {
      const { photos, ...formData } = assessment
      queueAssessment('claim', data.id, { ...formData, _alreadyUploadedPhotos: photos }, offlinePhotos)
    }

    if (!navigator.onLine || offlinePhotos.length > 0) {
      queueFallback()
      showToast('warning', `Claim ${data.claimNumber} submitted; the assessment is saved on this device and will sync once you're back online.`)
    } else {
      const { error: assessError } = await db.claimAssessments.create({ ...assessment, claimId: data.id })
      if (assessError) {
        queueFallback()
        showToast('warning', `Claim ${data.claimNumber} submitted; the assessment couldn't attach (${assessError}), so it's queued to retry automatically.`)
      } else {
        // Index this claim's photos for future duplicate-detection lookups
        // — best-effort, never blocks the claim that's already been created.
        void checkAndRecordPhotoDuplicates(assessment.photos, 'claim', data.id, data.claimNumber)
      }
    }
    await finishClaimSubmission(data, claim.fraudSignals)
  }

  const handleDelete = async (claim: Claim) => {
    const reason = window.prompt(
      `Delete claim ${claim.claimNumber} for ${claim.clientName}?\n\n`
      + 'The claim, its physical assessment and any fraud case are removed permanently and cannot be recovered. '
      + 'A record of this deletion stays in the activity log.\n\nEnter a reason for the record:',
    )
    if (reason === null) return
    if (!reason.trim()) { showToast('warning', 'A reason is required to delete a claim.'); return }

    // Written before the delete, while the claim's details still exist to be
    // captured. The log entry has to stand on its own afterwards, since
    // there will be no claim left to look up.
    await recordActivity({
      action: 'claim.deleted',
      actor: { id: user?.id, name: user?.name ?? 'Unknown', role: user?.role ?? 'unknown' },
      entityType: 'claim', entityId: claim.id, entityLabel: claim.claimNumber,
      detail: `${claim.clientName}, ${claim.productName}, ${claim.claimType}, $${claim.amount.toLocaleString()}, status ${claim.status}. Reason: ${reason.trim()}`,
      severity: 'warning',
    })

    const { error } = await db.claims.remove(claim.id)
    if (error) { showToast('error', error); return }
    setClaims(prev => prev.filter(c => c.id !== claim.id))
    setReviewClaim(null)
    showToast('success', `Claim ${claim.claimNumber} deleted. The deletion is recorded in the activity log.`)
  }

  /**
   * Records that an approved claim has actually been settled.
   *
   * Approval and payment are different events: one is a decision, the other
   * is money leaving the business. Nothing recorded the second, so every
   * claim stopped at 'approved' and the IPEC quarterly return reported
   * $0.00 claims incurred and a 0% claims ratio however much had been paid
   * out. Confirmed and logged, because it is a money statement.
   */
  const handleMarkPaid = async (claim: Claim) => {
    if (!window.confirm(
      `Record claim ${claim.claimNumber} as paid?\n\n`
      + `${claim.clientName} — $${claim.amount.toLocaleString()}\n\n`
      + 'Confirm only once the payout has actually been made. This is what the claims '
      + 'incurred figure on the IPEC return is built from, and it is logged against your name.',
    )) return

    const { data, error } = await db.claims.update(claim.id, { status: 'paid', resolvedAt: new Date().toISOString() })
    if (error || !data) { showToast('error', `Not recorded: ${error ?? 'the change did not reach the database.'}`); return }
    setClaims(prev => prev.map(c => c.id === data.id ? data : c))

    void recordActivity({
      action: 'claim.approved',
      actor: { id: user?.id, name: user?.name ?? 'Unknown', role: user?.role ?? 'unknown' },
      entityType: 'claim', entityId: claim.id, entityLabel: claim.claimNumber,
      detail: `Recorded as PAID: ${claim.clientName}, ${claim.productName}, $${claim.amount.toLocaleString()}.`,
      severity: 'warning',
    })
    showToast('success', `Claim ${claim.claimNumber} recorded as paid.`)
  }

  const handleUpdate = async (updated: Claim, notify: () => Promise<void>) => {
    const { data, error } = await db.claims.update(updated.id, updated)
    // The database's own words: "Failed to update claim." gave whoever hit
    // it nothing to act on, and the change genuinely did not happen.
    if (error || !data) { showToast('error', `Claim not updated: ${error ?? 'the change did not reach the database.'}`); return }
    setClaims(prev => prev.map(c => c.id === data.id ? data : c))
    setReviewClaim(null)
    showToast('success', `Claim ${data.claimNumber} updated.`)

    // Only outcome-changing transitions are audited; editing internal notes
    // is not a privilege decision and would only dilute the trail.
    const auditAction = data.status === 'approved' ? 'claim.approved'
      : data.status === 'rejected' && data.stage === 'closed' && updated.stage === 'closed' ? 'claim.declined'
      : data.stage === 'assessment' ? 'claim.intake_accepted'
      : data.stage === 'final_review' ? 'claim.escalated'
      : null
    if (auditAction) {
      void recordActivity({
        action: auditAction, actor: { id: user?.id, name: user?.name ?? 'Unknown', role: user?.role ?? 'unknown' },
        entityType: 'claim', entityId: data.id, entityLabel: data.claimNumber,
        detail: `${data.clientName}, $${data.amount.toLocaleString()}${data.assignedName ? `, now with ${data.assignedName}` : ''}`,
        severity: data.status === 'approved' ? 'warning' : 'notice',
      })
    }
    try { await notify() } catch { /**/ }
  }

  return (
    <div className="panel">
      <div className="panel-toolbar">
        <div className="filter-row">
          <input
            className="search-input"
            placeholder="Search claim number, policy number or client…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <select title="Filter by status" className="filter-select" value={statusFilter} onChange={e => setStatusFilter(e.target.value as ClaimStatus | 'all')}>
            <option value="all">All ({counts.all})</option>
            <option value="pending">Pending ({counts.pending})</option>
            <option value="under_review">Under Review ({counts.under_review})</option>
            <option value="approved">Approved ({counts.approved})</option>
            <option value="rejected">Rejected ({counts.rejected})</option>
            <option value="paid">Paid ({counts.paid})</option>
          </select>
        </div>
        {hasPermission('claims.create') && (
          <button type="button" className="btn btn-primary" onClick={() => setNewClaimKind('ordinary')}>+ New Claim</button>
        )}
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading claims…</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Claim No.</th>
                <th>Policy No.</th>
                <th>Client</th>
                <th>Product</th>
                <th>Type</th>
                <th>Amount</th>
                <th>Submitted</th>
                <th>Fraud Score</th>
                <th>Status</th>
                <th>Stage</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colSpan={11} className="td-empty">No claims found.</td></tr>
              ) : filtered.map(c => (
                <tr key={c.id}>
                  <td><span className="mono">{c.claimNumber}</span></td>
                  <td><span className="mono">{c.policyNumber || '—'}</span></td>
                  <td>{c.clientName}</td>
                  <td>{c.productName}</td>
                  <td>{c.claimType}</td>
                  <td>${c.amount.toLocaleString()}</td>
                  <td>{c.dateSubmitted}</td>
                  <td><ScoreBar score={c.fraudScore} /></td>
                  <td><span className={`pill pill-${c.status.replace('_', '-')}`}>{c.status.replace('_', ' ')}</span></td>
                  <td>
                    {c.stage === 'closed' ? '—' : (
                      <>
                        <span className="pill pill-active pill-xs">{c.stage.replace('_', ' ')}</span>
                        {c.assignedName && <span style={{ fontSize: 11, color: 'var(--muted)', display: 'block', marginTop: 2 }}>{c.assignedName}</span>}
                      </>
                    )}
                  </td>
                  <td>
                    <div className="action-btns">
                      {hasPermission('claims.edit') && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReviewClaim(c)}>Review</button>
                      )}
                      {/* An approved claim is a decision; a paid one is money
                          out of the door. Nothing recorded the second, so
                          "Claims Incurred" on the IPEC return sat at $0 no
                          matter how much had actually been settled. */}
                      {c.status === 'approved' && hasPermission('claims.approve') && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--success)' }}
                          onClick={() => handleMarkPaid(c)}
                        >
                          Mark Paid
                        </button>
                      )}
                      {hasPermission('claims.delete') && (
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          style={{ color: 'var(--danger)' }}
                          onClick={() => handleDelete(c)}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {newClaimKind === 'ordinary' && (
        <NewClaimModal
          onClose={() => setNewClaimKind(null)}
          onSave={handleAdd}
          showToast={showToast}
          claimKind={newClaimKind}
          onSwitchKind={setNewClaimKind}
        />
      )}
      {newClaimKind === 'agriculture' && (
        <NewAgricultureClaimModal
          onClose={() => setNewClaimKind(null)}
          onSave={handleAddAgriculture}
          showToast={showToast}
          claimKind={newClaimKind}
          onSwitchKind={setNewClaimKind}
        />
      )}
      {reviewClaim && (
        <ReviewClaimModal
          claim={reviewClaim}
          onClose={() => setReviewClaim(null)}
          onSave={handleUpdate}
          showToast={showToast}
        />
      )}
    </div>
  )
}
