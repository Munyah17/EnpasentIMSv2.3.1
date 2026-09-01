import { useState, useEffect } from 'react'
import type { ToastMessage, AppUser } from '../types'
import { SYSTEM_ROLES } from '../types'
import type { ActivePanel } from '../App'
import { db } from '../lib/db'
import { formatDate } from '../lib/dateUtils'
import { useAuth } from '../contexts/AuthContext'
import AddSystemUserModal from '../components/modals/AddSystemUserModal'
import PermissionsModal from '../components/modals/PermissionsModal'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const ROLE_CLASS: Record<string, string> = {
  super_admin: 'role-super-admin',
  admin: 'role-admin',
  tech_support: 'role-finance',
}

const AVATAR_CLASS: Record<string, string> = {
  super_admin: 'avatar-danger',
  admin: 'avatar-blue',
  tech_support: 'avatar-purple',
}

export default function SystemAccessRoles({ showToast }: Props) {
  const { user } = useAuth()
  const [accounts, setAccounts] = useState<AppUser[]>([])
  const [loading, setLoading] = useState(true)
  const [showAdd, setShowAdd] = useState(false)
  const [editUser, setEditUser] = useState<AppUser | null>(null)
  const [permUser, setPermUser] = useState<AppUser | null>(null)

  useEffect(() => {
    db.staff.list().then(({ data, error }) => {
      if (error) showToast('error', 'Failed to load system access accounts.')
      else if (data) setAccounts(data.filter(s => (SYSTEM_ROLES as string[]).includes(s.role)))
      setLoading(false)
    })
  }, [showToast])

  const handleSave = async (u: AppUser, password: string) => {
    if (editUser) {
      const { data, error } = await db.staff.update(u.id, u)
      if (error || !data) { showToast('error', error ?? 'Failed to update account.'); return }
      setAccounts(prev => prev.map(x => x.id === data.id ? data : x))
      showToast('success', `${data.name} updated.`)
    } else {
      const { data, error } = await db.staff.createSystemUser({
        name: u.name, username: u.username, email: u.email, password, phone: u.phone, role: u.role, department: u.department,
      })
      if (error || !data) { showToast('error', error ?? 'Failed to add account.'); return }
      setAccounts(prev => [...prev, data])
      showToast('success', `${data.name} added.`)
    }
    setShowAdd(false)
    setEditUser(null)
  }

  const handlePermissions = async (updated: AppUser) => {
    const { data, error } = await db.staff.update(updated.id, { permissions: updated.permissions })
    if (error || !data) { showToast('error', error ?? 'Failed to update permissions.'); return }
    setAccounts(prev => prev.map(a => a.id === data.id ? data : a))
    showToast('success', `Permissions updated for ${data.name}.`)
    setPermUser(null)
  }

  const toggleActive = async (id: string) => {
    const member = accounts.find(a => a.id === id)
    if (!member) return
    const { data, error } = await db.staff.update(id, { active: !member.active })
    if (error || !data) { showToast('error', error ?? 'Failed to update status.'); return }
    setAccounts(prev => prev.map(a => a.id === id ? data : a))
    showToast('info', 'Account status updated.')
  }

  const handleDelete = async (member: AppUser) => {
    if (!window.confirm(`Permanently delete ${member.name}? This removes their account entirely. This cannot be undone.`)) return
    const { error } = await db.staff.remove(member.id)
    if (error) { showToast('error', error); return }
    setAccounts(prev => prev.filter(a => a.id !== member.id))
    showToast('success', `${member.name} was deleted.`)
  }

  const handleResetPassword = async (userId: string, newPassword: string) => {
    const { error } = await db.staff.resetPassword(userId, newPassword)
    if (error) { showToast('error', error); return }
    showToast('success', 'Password reset successfully.')
  }

  return (
    <div className="panel">
      <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
        Super Admin, Admin, and Tech Support accounts: platform-wide system access. Work-role staff (Claims, Policy, Finance, Client Relations) are managed under <strong>Staff Management</strong>.
      </div>
      <div className="panel-toolbar">
        <div />
        <button type="button" className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add System Access Account</button>
      </div>

      <div className="card">
        {loading ? (
          <div className="empty-state">Loading accounts…</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Username</th>
                <th>Email</th>
                <th>System Role</th>
                <th>Department</th>
                <th>Phone</th>
                <th>Last Login</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map(a => (
                <tr key={a.id}>
                  <td>
                    <div className="staff-name-cell">
                      <div className={`staff-avatar ${AVATAR_CLASS[a.role] ?? 'avatar-blue'}`}>{a.name.charAt(0)}</div>
                      <strong>{a.name}</strong>
                    </div>
                  </td>
                  <td>{a.username ?? '—'}</td>
                  <td>{a.email}</td>
                  <td><span className={`pill ${ROLE_CLASS[a.role] ?? 'role-admin'}`}>{a.role.replace(/_/g, ' ')}</span></td>
                  <td>{a.department}</td>
                  <td>{a.phone ?? '—'}</td>
                  <td>{formatDate(a.lastLogin)}</td>
                  <td><span className={`pill ${a.active ? 'pill-active' : 'pill-cancelled'}`}>{a.active ? 'Active' : 'Inactive'}</span></td>
                  <td>
                    <div className="action-btns">
                      <button type="button" className="btn btn-ghost btn-sm" onClick={() => { setEditUser(a); setShowAdd(true) }}>Edit</button>
                      {a.role === 'tech_support' && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPermUser(a)}>Perms</button>
                      )}
                      {a.id !== user?.id && (
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleActive(a.id)}>
                          {a.active ? 'Disable' : 'Enable'}
                        </button>
                      )}
                      {a.role !== 'super_admin' && a.id !== user?.id && (
                        <button type="button" className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(a)}>
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

      {(showAdd || editUser) && (
        <AddSystemUserModal
          user={editUser}
          onClose={() => { setShowAdd(false); setEditUser(null) }}
          onSave={handleSave}
          onResetPassword={handleResetPassword}
        />
      )}
      {permUser && (
        <PermissionsModal
          staff={permUser}
          onClose={() => setPermUser(null)}
          onSave={handlePermissions}
        />
      )}
    </div>
  )
}
