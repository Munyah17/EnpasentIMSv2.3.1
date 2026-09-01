import { useState } from 'react'
import type { PolicyCard, PolicyCardStatus } from '../../types'
import type { PolicyMember } from '../../lib/memberNumbers'
import { db } from '../../lib/db'
import ValidationSummary, { fieldId, invalidClass, scrollToField } from '../ui/ValidationSummary'
import type { MissingField } from '../ui/ValidationSummary'

/**
 * Issues or manages one member's card.
 *
 * The RFID tag is whatever number the card transmits — read it off the
 * encoder, or tap the card on a reader with the field focused, which is how
 * every USB RFID reader behaves (they type the number and press Enter).
 * Nothing is written to the card here; the tag is simply recorded against
 * the member so a later tap resolves to them.
 */

interface Props {
  member: PolicyMember
  existing?: PolicyCard
  issuedBy?: string
  onClose: () => void
  onSaved: (card: PolicyCard) => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

const STATUS_OPTIONS: { value: PolicyCardStatus; label: string; help: string }[] = [
  { value: 'active', label: 'Active', help: 'Card is in the member\'s hands and should be accepted.' },
  { value: 'suspended', label: 'Suspended', help: 'Temporarily refuse this card without cancelling it.' },
  { value: 'lost', label: 'Reported Lost', help: 'The card is out there somewhere; a reader must refuse it.' },
  { value: 'replaced', label: 'Replaced', help: 'Superseded by a newly issued card.' },
]

export default function IssueCardModal({ member, existing, issuedBy, onClose, onSaved, showToast }: Props) {
  const [rfidTag, setRfidTag] = useState(existing?.rfidTag ?? '')
  const [status, setStatus] = useState<PolicyCardStatus>(existing?.status ?? 'active')
  const [expiresAt, setExpiresAt] = useState(existing?.expiresAt ?? '')
  const [notes, setNotes] = useState(existing?.notes ?? '')
  const [saving, setSaving] = useState(false)
  const [attempted, setAttempted] = useState(false)

  const missing: MissingField[] = []
  // A tag is optional — a virtual card is perfectly valid on its own — but
  // a card that is meant to be tapped needs one, so an "active" card with a
  // blank tag is only allowed when no tag has ever been assigned.
  if (status !== 'active' && !existing) {
    missing.push({ key: 'status', label: 'Status', hint: 'a brand-new card can only be issued as active.' })
  }

  const handleSave = async () => {
    setAttempted(true)
    if (missing.length > 0) {
      showToast('error', `Not saved: ${missing.map(m => m.label).join(', ')}.`)
      scrollToField(missing[0].key)
      return
    }
    setSaving(true)

    const trimmedTag = rfidTag.trim() || undefined
    const { data, error } = existing
      ? await db.policyCards.update(existing.id, { rfidTag: trimmedTag, status, expiresAt: expiresAt || undefined, notes: notes.trim() || undefined })
      : await db.policyCards.issue({
        memberNumber: member.memberNumber,
        policyId: member.policyId,
        policyNumber: member.policyNumber,
        memberPosition: member.position,
        memberName: member.name,
        holderName: member.holderName,
        clientId: member.holderClientId,
        rfidTag: trimmedTag,
        status,
        expiresAt: expiresAt || undefined,
        notes: notes.trim() || undefined,
        issuedBy,
      })

    setSaving(false)
    if (error || !data) { showToast('error', error ?? 'Could not save this card.'); return }
    showToast('success', existing ? `Card ${member.memberNumber} updated.` : `Card issued to ${member.name} (${member.memberNumber}).`)
    onSaved(data)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{existing ? 'Manage Card' : 'Issue Card'}: {member.memberNumber}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="info-banner info-banner-info">
            <strong>{member.name}</strong> — {member.role === 'holder' ? 'policyholder' : `${member.relationship || 'dependant'}, carried by ${member.holderName}`}
            {' '}on policy <span className="mono">{member.policyNumber}</span>.
          </div>

          <ValidationSummary missing={missing} attempted={attempted} action="save" />

          <div className="form-group">
            <label>RFID Tag / Card Serial</label>
            <input
              className="form-control mono"
              value={rfidTag}
              onChange={e => setRfidTag(e.target.value)}
              placeholder="Tap the card on a reader, or type its serial"
              autoFocus
            />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              Most USB readers type the number and press Enter — put the cursor here and tap the card. Leave blank
              for a virtual-only card; you can add the tag when the physical card is encoded.
            </span>
          </div>

          <div className="form-group" id={fieldId('status')}>
            <label>Status</label>
            <select className={invalidClass(missing, attempted, 'status')} value={status} onChange={e => setStatus(e.target.value as PolicyCardStatus)}>
              {STATUS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>
              {STATUS_OPTIONS.find(o => o.value === status)?.help}
            </span>
          </div>

          <div className="form-group">
            <label>Valid Until <span style={{ fontWeight: 400, color: 'var(--muted)' }}>(optional)</span></label>
            <input type="date" className="form-control" value={expiresAt} onChange={e => setExpiresAt(e.target.value)} />
          </div>

          <div className="form-group">
            <label>Notes</label>
            <textarea className="form-control" rows={2} value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. replacement for a card reported lost on 12 Aug" />
          </div>

          {existing && (
            <p style={{ fontSize: 11, color: 'var(--muted)' }}>
              Cards are never deleted — a lost card's tag still exists in the world, and keeping it on file is what
              lets a reader recognise and refuse it.
            </p>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Saving…' : existing ? 'Save Changes' : 'Issue Card'}
          </button>
        </div>
      </div>
    </div>
  )
}
