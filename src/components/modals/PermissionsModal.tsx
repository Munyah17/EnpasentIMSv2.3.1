import { useState, useEffect } from 'react'
import type { AppUser, CustomRole } from '../../types'
import { db } from '../../lib/db'
import { PERMISSION_CATALOG } from '../../lib/permissions'

interface Props {
  staff: AppUser
  onClose: () => void
  onSave: (staff: AppUser) => void
}

export default function PermissionsModal({ staff, onClose, onSave }: Props) {
  const [perms, setPerms] = useState<Set<string>>(new Set(staff.permissions))
  const [customRoleId, setCustomRoleId] = useState(staff.customRoleId ?? '')
  const [roles, setRoles] = useState<CustomRole[]>([])
  const isBlanket = staff.permissions.includes('all') || staff.permissions.includes('all_except_super')

  useEffect(() => { db.customRoles.list().then(({ data }) => setRoles(data)) }, [])

  const toggle = (key: string) => {
    setPerms(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const toggleGroup = (keys: string[], allChecked: boolean) => {
    setPerms(prev => {
      const next = new Set(prev)
      keys.forEach(k => allChecked ? next.delete(k) : next.add(k))
      return next
    })
  }

  const applyRole = (roleId: string) => {
    setCustomRoleId(roleId)
    const role = roles.find(r => r.id === roleId)
    if (role) setPerms(new Set(role.permissions))
  }

  const handleSave = () => {
    onSave({ ...staff, permissions: Array.from(perms), customRoleId: customRoleId || undefined })
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <h3>Permissions: {staff.name}</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--muted)', marginBottom: '1rem', fontSize: '0.85rem' }}>
            Base role: <strong>{staff.role.replace(/_/g, ' ')}</strong>. Apply a saved custom role as a starting point, or tick individual rights below.
          </p>
          <div className="form-group" style={{ marginBottom: '1rem' }}>
            <label>Apply Custom Role</label>
            <select className="form-control" value={customRoleId} onChange={e => applyRole(e.target.value)}>
              <option value="">None (manual permissions)</option>
              {roles.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </div>
          {isBlanket && (
            <div className="info-banner info-banner-info" style={{ marginBottom: '1rem' }}>
              This account currently has blanket access from its base role; every right below is already granted. Applying a custom role or unticking rights here will scope it down.
            </div>
          )}
          <div className="permissions-groups">
            {PERMISSION_CATALOG.map(g => {
              const keys = g.items.map(i => i.key)
              const allChecked = keys.every(k => perms.has(k)) || isBlanket
              return (
                <div key={g.group} className="permissions-group">
                  <div className="permissions-group-header">
                    <span>{g.group}</span>
                    <button type="button" className="btn btn-ghost btn-sm" disabled={isBlanket} onClick={() => toggleGroup(keys, allChecked)}>
                      {allChecked ? 'Clear all' : 'Select all'}
                    </button>
                  </div>
                  <div className="permissions-grid">
                    {g.items.map(p => (
                      <label key={p.key} className="permission-item">
                        <input type="checkbox" checked={perms.has(p.key) || isBlanket} onChange={() => toggle(p.key)} disabled={isBlanket} />
                        <span>{p.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={handleSave}>Save Permissions</button>
        </div>
      </div>
    </div>
  )
}
