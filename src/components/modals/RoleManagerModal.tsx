import { useState, useEffect } from 'react'
import type { CustomRole } from '../../types'
import { db } from '../../lib/db'
import { PERMISSION_CATALOG } from '../../lib/permissions'

interface Props {
  onClose: () => void
  showToast: (type: 'success' | 'error' | 'warning' | 'info', message: string) => void
}

const EMPTY_DRAFT = { name: '', description: '', permissions: [] as string[] }

export default function RoleManagerModal({ onClose, showToast }: Props) {
  const [roles, setRoles] = useState<CustomRole[]>([])
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<CustomRole | null>(null)
  const [draft, setDraft] = useState(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)

  const load = () => db.customRoles.list().then(({ data }) => { setRoles(data); setLoading(false) })
  useEffect(() => { load() }, [])

  const startNew = () => { setEditing(null); setDraft(EMPTY_DRAFT) }
  const startEdit = (r: CustomRole) => { setEditing(r); setDraft({ name: r.name, description: r.description ?? '', permissions: [...r.permissions] }) }

  const togglePerm = (key: string) => {
    setDraft(prev => ({
      ...prev,
      permissions: prev.permissions.includes(key) ? prev.permissions.filter(p => p !== key) : [...prev.permissions, key],
    }))
  }

  const toggleGroup = (keys: string[], allChecked: boolean) => {
    setDraft(prev => ({
      ...prev,
      permissions: allChecked ? prev.permissions.filter(p => !keys.includes(p)) : [...new Set([...prev.permissions, ...keys])],
    }))
  }

  const handleSave = async () => {
    if (!draft.name.trim()) { showToast('error', 'Give the role a name.'); return }
    setSaving(true)
    const payload = { name: draft.name.trim(), description: draft.description.trim() || undefined, permissions: draft.permissions }
    const { data, error } = editing ? await db.customRoles.update(editing.id, payload) : await db.customRoles.create(payload)
    setSaving(false)
    if (error || !data) { showToast('error', error ?? 'Failed to save role.'); return }
    showToast('success', `Role "${data.name}" saved.`)
    startNew()
    load()
  }

  const handleDelete = async (r: CustomRole) => {
    if (!window.confirm(`Delete the "${r.name}" role? Staff currently assigned to it will keep their existing permissions but lose the role label.`)) return
    const { error } = await db.customRoles.remove(r.id)
    if (error) { showToast('error', error); return }
    showToast('success', `Role "${r.name}" deleted.`)
    if (editing?.id === r.id) startNew()
    load()
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 780 }}>
        <div className="modal-header">
          <h3>Manage Custom Roles</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <p style={{ color: 'var(--muted)', fontSize: '0.85rem', marginBottom: '1rem' }}>
            Define named, reusable permission bundles you can assign to staff, separate from their base account role.
            Staff and client deletion are never included here; those stay Super Admin-only regardless of role.
          </p>
          <div className="role-manager-layout">
            <div className="role-manager-list">
              <button type="button" className="btn btn-ghost btn-sm btn-full" onClick={startNew} style={{ marginBottom: 8 }}>+ New Role</button>
              {loading ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>Loading…</p>
              ) : roles.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--muted)' }}>No custom roles yet.</p>
              ) : roles.map(r => (
                <div key={r.id} className={`role-manager-item${editing?.id === r.id ? ' active' : ''}`}>
                  <button type="button" className="role-manager-item-btn" onClick={() => startEdit(r)}>
                    <strong>{r.name}</strong>
                    <span>{r.permissions.length} right{r.permissions.length === 1 ? '' : 's'}</span>
                  </button>
                  <button type="button" className="role-manager-item-delete" onClick={() => handleDelete(r)} title="Delete role">✕</button>
                </div>
              ))}
            </div>
            <div className="role-manager-editor">
              <div className="form-group">
                <label>Role Name *</label>
                <input className="form-control" placeholder="e.g. Claims Processor" value={draft.name} onChange={e => setDraft(d => ({ ...d, name: e.target.value }))} />
              </div>
              <div className="form-group">
                <label>Description</label>
                <input className="form-control" placeholder="Short description of this role's purpose" value={draft.description} onChange={e => setDraft(d => ({ ...d, description: e.target.value }))} />
              </div>
              <label style={{ display: 'block', marginBottom: 6 }}>Permissions</label>
              <div className="permissions-groups">
                {PERMISSION_CATALOG.map(g => {
                  const keys = g.items.map(i => i.key)
                  const allChecked = keys.every(k => draft.permissions.includes(k))
                  return (
                    <div key={g.group} className="permissions-group">
                      <div className="permissions-group-header">
                        <span>{g.group}</span>
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => toggleGroup(keys, allChecked)}>
                          {allChecked ? 'Clear all' : 'Select all'}
                        </button>
                      </div>
                      <div className="permissions-grid">
                        {g.items.map(p => (
                          <label key={p.key} className="permission-item">
                            <input type="checkbox" checked={draft.permissions.includes(p.key)} onChange={() => togglePerm(p.key)} />
                            <span>{p.label}</span>
                          </label>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving || !draft.name.trim()}>
            {saving ? 'Saving…' : editing ? 'Update Role' : 'Create Role'}
          </button>
        </div>
      </div>
    </div>
  )
}
