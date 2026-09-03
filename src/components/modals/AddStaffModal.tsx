import { useState, useEffect } from 'react'
import type { AppUser, UserRole, CustomRole } from '../../types'
import { db } from '../../lib/db'
import PhoneInput from '../ui/PhoneInput'

interface Props {
  staff: AppUser | null
  onClose: () => void
  onSave: (staff: AppUser, password: string) => void
  /** Only used in edit mode — sets a new password for an existing staff
   *  member (self-service Change Password needs their CURRENT password,
   *  which isn't something an admin resetting a locked-out account has). */
  onResetPassword: (staffId: string, newPassword: string) => Promise<void>
}

// Work roles only — Super Admin, Admin, and Tech Support are system access
// roles, managed on the System Access Roles page instead.
const ROLES: UserRole[] = ['claims_officer', 'policy_admin', 'finance', 'client_relations', 'agent']
const DEPARTMENTS = ['Claims', 'Policy Administration', 'Finance', 'Client Relations', 'Sales & Agents', 'Administration', 'IT']

export default function AddStaffModal({ staff, onClose, onSave, onResetPassword }: Props) {
  const [name, setName] = useState(staff?.name ?? '')
  const [username, setUsername] = useState(staff?.username ?? '')
  const [email, setEmail] = useState(staff?.email ?? '')
  const [phone, setPhone] = useState(staff?.phone ?? '')
  const [role, setRole] = useState<UserRole>(staff?.role ?? 'client_relations')
  const [department, setDepartment] = useState(staff?.department ?? 'Client Relations')
  const [password, setPassword] = useState('')
  const [resetPwd, setResetPwd] = useState('')
  const [resettingPwd, setResettingPwd] = useState(false)
  const [customRoleId, setCustomRoleId] = useState(staff?.customRoleId ?? '')
  const [roles, setRoles] = useState<CustomRole[]>([])

  useEffect(() => { db.customRoles.list().then(({ data }) => setRoles(data)) }, [])

  // New accounts are real Supabase Auth users now, so a real password is
  // required — no more silent 'staff1234' default. Editing an existing
  // member can leave it blank (this modal doesn't change an existing
  // user's password; that's handled elsewhere).
  const passwordValid = staff ? true : password.length >= 8
  const canSave = !!name && !!username.trim() && !!email && passwordValid

  const handleSave = () => {
    if (!canSave) return
    // Only snapshot the role's permissions in when the custom role selection
    // actually changed — otherwise re-saving this form for an unrelated edit
    // (e.g. phone number) would silently wipe out any manual permission
    // tweaks made afterwards via PermissionsModal.
    const roleChanged = customRoleId !== (staff?.customRoleId ?? '')
    const selectedRole = roleChanged ? roles.find(r => r.id === customRoleId) : undefined
    // A brand-new account with no custom role picked still needs a sane
    // default: Admin gets full access short of the two hard-gated Super
    // Admin-only actions (same 'all_except_super' sentinel AuthContext's
    // own fallback already uses), matching the 2026-08 access review.
    // Other staff roles default to none — granted explicitly via the
    // Permissions modal or a custom role, same as before this feature.
    const defaultPermissions = !staff ? (role === 'admin' ? ['all_except_super'] : []) : (staff.permissions ?? [])
    const member: AppUser = {
      id: staff?.id ?? '',
      name, username: username.trim(), email, phone, role, department,
      active: staff?.active ?? true,
      permissions: selectedRole ? selectedRole.permissions : defaultPermissions,
      customRoleId: customRoleId || undefined,
    }
    onSave(member, password)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 520 }}>
        <div className="modal-header">
          <h3>{staff ? 'Edit Staff Member' : 'Add Staff Member'}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
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
              <input type="email" className="form-control" value={email} onChange={e => setEmail(e.target.value)} placeholder="staff@enpassent.co.zw" />
            </div>
            <div className="form-group">
              <label>Phone Number</label>
              <PhoneInput value={phone} onChange={setPhone} />
            </div>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>Role *</label>
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
          <div className="form-group">
            <label>Custom Role (optional)</label>
            <select className="form-control" value={customRoleId} onChange={e => setCustomRoleId(e.target.value)}>
              <option value="">None (default permissions for this role)</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          <div className="form-row">
            <div className="form-group">
              <label>{staff ? 'Reset Password' : 'Temporary Password *'}</label>
              {staff ? (
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
                      await onResetPassword(staff.id, resetPwd)
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
            {staff ? 'Save Changes' : 'Add Staff Member'}
          </button>
        </div>
      </div>
    </div>
  )
}
