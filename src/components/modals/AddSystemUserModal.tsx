import { useState } from 'react'
import type { AppUser, UserRole } from '../../types'
import PhoneInput from '../ui/PhoneInput'

interface Props {
  user: AppUser | null
  onClose: () => void
  onSave: (user: AppUser, password: string) => void
  onResetPassword: (userId: string, newPassword: string) => Promise<void>
}

const ROLES: UserRole[] = ['super_admin', 'admin', 'tech_support']
const DEPARTMENTS = ['Management', 'Administration', 'IT']

export default function AddSystemUserModal({ user, onClose, onSave, onResetPassword }: Props) {
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [email, setEmail] = useState(user?.email ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [role, setRole] = useState<UserRole>(user?.role ?? 'admin')
  const [department, setDepartment] = useState(user?.department ?? 'Administration')
  const [password, setPassword] = useState('')
  const [resetPwd, setResetPwd] = useState('')
  const [resettingPwd, setResettingPwd] = useState(false)

  const passwordValid = user ? true : password.length >= 8
  const canSave = !!name && !!username.trim() && !!email && passwordValid

  const handleSave = () => {
    if (!canSave) return
    const member: AppUser = {
      id: user?.id ?? '',
      name, username: username.trim(), email, phone, role, department,
      active: user?.active ?? true,
      permissions: user?.permissions ?? [],
    }
    onSave(member, password)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{user ? 'Edit System Access Account' : 'Add System Access Account'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="info-banner info-banner-warning" style={{ marginBottom: '1rem' }}>
            System access roles (Super Admin, Admin, Tech Support) control platform-wide administrative access, separate from work roles managed under Staff Management.
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Full Name *</label>
              <input className="form-control" value={name} onChange={e => setName(e.target.value)} placeholder="Full name" />
            </div>
            <div className="form-group">
              <label>Username *</label>
              <input className="form-control" value={username} onChange={e => setUsername(e.target.value)} placeholder="Nickname used to sign in" />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Email Address *</label>
              <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@tariqify.com" />
            </div>
            <div className="form-group">
              <label>Phone Number</label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>System Role *</label>
              <select className="form-control" value={role} onChange={e => setRole(e.target.value as UserRole)}>
                {ROLES.map(r => <option key={r} value={r}>{r.replace(/_/g, ' ')}</option>)}
              </select>
            </div>
            <div className="form-group">
              <label>Department</label>
              <select className="form-control" value={department} onChange={e => setDepartment(e.target.value)}>
                {DEPARTMENTS.map(d => <option key={d} value={d}>{d}</option>)}
              </select>
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{user ? 'Reset Password' : 'Temporary Password *'}</label>
              {user ? (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input
                    type="password"
                    className="form-control"
                    value={resetPwd}
                    onChange={e => setResetPwd(e.target.value)}
                    placeholder="New password, min. 8 characters"
                  />
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    disabled={resetPwd.length < 8 || resettingPwd}
                    onClick={async () => {
                      setResettingPwd(true)
                      await onResetPassword(user.id, resetPwd)
                      setResetPwd('')
                      setResettingPwd(false)
                    }}
                  >
                    {resettingPwd ? 'Resetting…' : 'Reset'}
                  </button>
                </div>
              ) : (
                <input type="password" className="form-control" value={password} onChange={e => setPassword(e.target.value)} placeholder="Min. 8 characters" />
              )}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={!canSave}>
            {user ? 'Save Changes' : 'Add Account'}
          </button>
        </div>
      </div>
    </div>
  )
}
