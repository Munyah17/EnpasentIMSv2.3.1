interface Props {
  onConfirm: () => void
  onCancel: () => void
  confirming?: boolean
}

/** Shown once, right before a claim actually submits — an educational
 *  reminder, not a threat, of what filing a false or exaggerated claim
 *  means. Applies to both the ordinary and agriculture claim flows. */
export default function FraudNoticeModal({ onConfirm, onCancel, confirming }: Props) {
  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 480 }}>
        <div className="modal-header">
          <h3>Before You Submit</h3>
          <button className="modal-close" onClick={onCancel}>✕</button>
        </div>
        <div className="modal-body">
          <div className="info-banner info-banner-info" style={{ marginBottom: 14 }}>
            ℹ A quick reminder before this claim goes in.
          </div>
          <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
            Please make sure everything in this claim (the description, amounts, dates, and any photos or documents attached) accurately reflects what actually happened. Claims are reviewed carefully, and photos are automatically checked for their capture date and authenticity.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 10 }}>
            Submitting a claim that's exaggerated, staged, or based on false information is insurance fraud. Under Zimbabwean law this can mean the claim being rejected, the policy being cancelled, and in serious cases, criminal prosecution under the Insurance Act and the Criminal Law (Codification and Reform) Act.
          </p>
          <p style={{ fontSize: 13, lineHeight: 1.6 }}>
            If everything above is accurate to the best of your knowledge, go ahead and submit.
          </p>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onCancel} disabled={confirming}>Let Me Review Again</button>
          <button className="btn btn-primary" onClick={onConfirm} disabled={confirming}>
            {confirming ? 'Submitting…' : 'I Confirm: Submit Claim'}
          </button>
        </div>
      </div>
    </div>
  )
}
