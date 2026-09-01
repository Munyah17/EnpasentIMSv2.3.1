import { useState } from 'react'

interface Props {
  staffName: string
  onClose: () => void
  onSave: () => void
}

export default function ChangePasswordModal({ staffName, onClose, onSave }: Props) {
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [error, setError] = useState('')

  const handleSave = () => {
    if (newPwd.length < 8) { setError('Password must be at least 8 characters.'); return }
    if (newPwd !== confirmPwd) { setError('Passwords do not match.'); return }
    onSave()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 420 }}>
        <div className="modal-header">
          <h3>Change Password: {staffName}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="form-group">
            <label>New Password</label>
            <input type="password" className="form-control" value={newPwd} onChange={e => { setNewPwd(e.target.value); setError('') }} placeholder="Min. 8 characters" />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" className="form-control" value={confirmPwd} onChange={e => { setConfirmPwd(e.target.value); setError('') }} />
          </div>
          {error && <div className="login-error">{error}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!newPwd || !confirmPwd}>
            Update Password
          </button>
        </div>
      </div>
    </div>
  )
}
