import type { EmailMessage } from '../../types'
import { formatDateTime } from '../../lib/dateUtils'

interface Props {
  email: EmailMessage
  onClose: () => void
  onReply: (to: string, subject: string) => void
}

export default function EmailDetailModal({ email, onClose, onReply }: Props) {
  const formatDate = (ts: string) => formatDateTime(ts)

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 640 }}>
        <div className="modal-header">
          <h3>{email.subject}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="email-detail-meta">
            <div><span className="detail-label">From:</span> {email.fromName} &lt;{email.from}&gt;</div>
            <div><span className="detail-label">To:</span> {email.to}</div>
            <div><span className="detail-label">Date:</span> {formatDate(email.timestamp)}</div>
            {email.linkedTo && <div><span className="detail-label">Linked to:</span> <span className="mono">{email.linkedTo}</span></div>}
          </div>
          <div className="email-detail-body">
            {email.body.split('\n').map((line, i) => <p key={i}>{line || <br />}</p>)}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={() => onReply(email.from, `Re: ${email.subject}`)}>
            ↩ Reply
          </button>
        </div>
      </div>
    </div>
  )
}
