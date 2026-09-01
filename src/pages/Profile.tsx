import { useState, useEffect } from 'react'
import type { ToastMessage } from '../types'
import type { ActivePanel } from '../App'
import { useAuth } from '../contexts/AuthContext'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import PhoneInput from '../components/ui/PhoneInput'
import { formatDateTime } from '../lib/dateUtils'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

export default function Profile({ showToast }: Props) {
  const { user, updateLocalUser, reauthenticate } = useAuth()
  const [activeTab, setActiveTab] = useState<'info' | 'password' | 'notifications' | 'audit'>('info')
  const [name, setName] = useState(user?.name ?? '')
  const [username, setUsername] = useState(user?.username ?? '')
  const [phone, setPhone] = useState(user?.phone ?? '')
  const [savingInfo, setSavingInfo] = useState(false)

  const [newEmail, setNewEmail] = useState('')
  const [emailPwd, setEmailPwd] = useState('')
  const [savingEmail, setSavingEmail] = useState(false)

  const [currentPwd, setCurrentPwd] = useState('')
  const [newPwd, setNewPwd] = useState('')
  const [confirmPwd, setConfirmPwd] = useState('')
  const [savingPwd, setSavingPwd] = useState(false)
  const [signingOutOthers, setSigningOutOthers] = useState(false)

  const signOutOtherSessions = async () => {
    if (!window.confirm('Sign this account out everywhere except this device? Anyone else currently signed in as you will be logged out immediately.')) return
    setSigningOutOthers(true)
    try {
      const { error } = await supabase.auth.signOut({ scope: 'others' })
      if (error) { showToast('error', `Failed to sign out other sessions: ${error.message}`); return }
      showToast('success', 'All other sessions have been signed out.')
    } finally {
      setSigningOutOthers(false)
    }
  }

  const saveInfo = async () => {
    if (!user) return
    if (!name.trim()) { showToast('warning', 'Full name cannot be empty.'); return }
    if (!username.trim()) { showToast('warning', 'Username cannot be empty.'); return }
    setSavingInfo(true)
    try {
      // Only ever sends name/username/phone — role, department, active, and
      // permissions are never part of this payload, and the database itself
      // now rejects any attempt to change them on your own row (see
      // database/fix_profiles_self_update_privilege_escalation.sql).
      const { data, error } = await db.staff.update(user.id, { name: name.trim(), username: username.trim(), phone: phone.trim() })
      if (error || !data) { showToast('error', error ?? 'Failed to update profile.'); return }
      updateLocalUser({ name: data.name, username: data.username, phone: data.phone })
      showToast('success', 'Profile updated successfully.')
    } finally {
      setSavingInfo(false)
    }
  }

  const changeEmail = async () => {
    if (!newEmail.trim() || !newEmail.includes('@')) { showToast('warning', 'Enter a valid email address.'); return }
    if (newEmail.trim().toLowerCase() === user?.email.toLowerCase()) { showToast('warning', 'That is already your current email.'); return }
    if (!emailPwd) { showToast('warning', 'Enter your current password to confirm this change.'); return }
    setSavingEmail(true)
    try {
      const authorized = await reauthenticate(emailPwd)
      if (!authorized) { showToast('error', 'Current password is incorrect.'); return }
      const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
      if (error) { showToast('error', `Failed to update email: ${error.message}`); return }
      showToast('success', 'Check your inbox to confirm this email change before it takes effect.')
      setNewEmail(''); setEmailPwd('')
    } finally {
      setSavingEmail(false)
    }
  }

  const changePwd = async () => {
    if (!currentPwd) { showToast('warning', 'Enter your current password.'); return }
    if (newPwd !== confirmPwd) { showToast('error', 'New passwords do not match.'); return }
    if (newPwd.length < 8) { showToast('warning', 'Password must be at least 8 characters.'); return }
    setSavingPwd(true)
    try {
      const authorized = await reauthenticate(currentPwd)
      if (!authorized) { showToast('error', 'Current password is incorrect.'); return }
      const { error } = await supabase.auth.updateUser({ password: newPwd })
      if (error) { showToast('error', `Failed to change password: ${error.message}`); return }
      showToast('success', 'Password changed successfully.')
      setCurrentPwd(''); setNewPwd(''); setConfirmPwd('')
    } finally {
      setSavingPwd(false)
    }
  }

  const [loginHistory, setLoginHistory] = useState<{ success: boolean; ts: string }[] | null>(null)

  useEffect(() => {
    if (activeTab !== 'audit' || !user || loginHistory !== null) return
    db.loginAttempts.historyFor(user.email).then(({ data }) => setLoginHistory(data))
  }, [activeTab, user, loginHistory])

  const last24h = (loginHistory ?? []).filter(h => Date.now() - new Date(h.ts).getTime() < 86400000)
  const failedLast24h = last24h.filter(h => !h.success).length
  const lastSuccess = (loginHistory ?? []).find(h => h.success)

  return (
    <div className="panel">
      <div className="profile-layout">
        <div className="profile-card">
          <div className="profile-avatar-large">{user?.name.charAt(0)}</div>
          <div className="profile-name">{user?.name}</div>
          <div className="profile-role">{user?.role.replace(/_/g, ' ')}</div>
          <div className="profile-dept">{user?.department}</div>
          <div className="profile-email">{user?.email}</div>
        </div>

        <div className="profile-content">
          <div className="tabs">
            {([['info', 'Profile Info'], ['password', 'Change Password'], ['notifications', 'Notifications'], ...(user?.role !== 'policyholder' ? [['audit', 'Audit Log']] : [])]).map(([t, label]) => (
              <button key={t as string} className={`tab${activeTab === t ? ' active' : ''}`} onClick={() => setActiveTab(t as typeof activeTab)}>
                {label as string}
              </button>
            ))}
          </div>

          {activeTab === 'info' && (
            <>
              <div className="card">
                <div className="form-row">
                  <div className="form-group">
                    <label>Full Name</label>
                    <input className="form-control" value={name} onChange={e => setName(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>Username</label>
                    <input className="form-control" value={username} onChange={e => setUsername(e.target.value)} placeholder="Nickname used to sign in" />
                  </div>
                </div>
                <div className="form-group">
                  <label>Phone Number</label>
                  <PhoneInput value={phone} onChange={setPhone} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>Role</label>
                    <input className="form-control" value={user?.role.replace(/_/g, ' ') ?? ''} disabled style={{ opacity: 0.6 }} />
                  </div>
                  <div className="form-group">
                    <label>Department</label>
                    <input className="form-control" value={user?.department ?? ''} disabled style={{ opacity: 0.6 }} />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={saveInfo} disabled={savingInfo} style={{ alignSelf: 'flex-start' }}>
                  {savingInfo ? 'Saving…' : 'Save Changes'}
                </button>
              </div>

              <div className="card">
                <h3>Change Email Address</h3>
                <div className="form-group">
                  <label>Current Email</label>
                  <input className="form-control" value={user?.email ?? ''} disabled style={{ opacity: 0.6 }} />
                </div>
                <div className="form-row">
                  <div className="form-group">
                    <label>New Email Address</label>
                    <input type="email" className="form-control" value={newEmail} onChange={e => setNewEmail(e.target.value)} placeholder="new@example.com" />
                  </div>
                  <div className="form-group">
                    <label>Confirm Current Password</label>
                    <input type="password" className="form-control" value={emailPwd} onChange={e => setEmailPwd(e.target.value)} placeholder="Required to confirm this change" />
                  </div>
                </div>
                <button className="btn btn-primary" onClick={changeEmail} disabled={savingEmail} style={{ alignSelf: 'flex-start' }}>
                  {savingEmail ? 'Updating…' : 'Update Email'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'password' && (
            <>
              <div className="card" style={{ maxWidth: 440 }}>
                <div className="form-group">
                  <label>Current Password</label>
                  <input type="password" className="form-control" value={currentPwd} onChange={e => setCurrentPwd(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>New Password</label>
                  <input type="password" className="form-control" value={newPwd} onChange={e => setNewPwd(e.target.value)} />
                </div>
                <div className="form-group">
                  <label>Confirm New Password</label>
                  <input type="password" className="form-control" value={confirmPwd} onChange={e => setConfirmPwd(e.target.value)} />
                </div>
                <button className="btn btn-primary" onClick={changePwd} disabled={savingPwd} style={{ alignSelf: 'flex-start' }}>
                  {savingPwd ? 'Changing…' : 'Change Password'}
                </button>
              </div>

              <div className="card" style={{ maxWidth: 440 }}>
                <h3>Sessions</h3>
                <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 12 }}>
                  If you suspect this account is signed in somewhere it shouldn't be, sign every other session out immediately. This device stays signed in.
                </p>
                <button className="btn btn-ghost" style={{ color: 'var(--danger)', alignSelf: 'flex-start' }} onClick={signOutOtherSessions} disabled={signingOutOthers}>
                  {signingOutOthers ? 'Signing out…' : '⎋ Sign Out Other Sessions'}
                </button>
              </div>
            </>
          )}

          {activeTab === 'notifications' && (
            <div className="card" style={{ maxWidth: 480 }}>
              <h3>Notification Preferences</h3>
              {[
                ['Email me on new policy', true],
                ['Email me on claim submission', true],
                ['Email me on payment received', false],
                ['WhatsApp alerts for fraud', true],
                ['SMS on overdue premiums', true],
              ].map(([label, def]) => (
                <div key={label as string} className="form-group" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <input type="checkbox" defaultChecked={def as boolean} id={label as string} />
                  <label htmlFor={label as string} style={{ marginBottom: 0, cursor: 'pointer' }}>{label as string}</label>
                </div>
              ))}
              <button className="btn btn-primary" style={{ alignSelf: 'flex-start' }} onClick={() => showToast('success', 'Notification preferences saved.')}>
                Save Preferences
              </button>
            </div>
          )}

          {activeTab === 'audit' && (
            <>
              <div className="stats-grid" style={{ gridTemplateColumns: 'repeat(3, 1fr)', marginBottom: 16 }}>
                <div className="stat-card">
                  <div className="stat-body">
                    <div className="stat-value">{lastSuccess ? formatDateTime(lastSuccess.ts) : '—'}</div>
                    <div className="stat-label">Last Successful Sign-In</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-body">
                    <div className="stat-value" style={{ color: failedLast24h >= 3 ? 'var(--danger)' : 'inherit' }}>{failedLast24h}</div>
                    <div className="stat-label">Failed Attempts (24h)</div>
                  </div>
                </div>
                <div className="stat-card">
                  <div className="stat-body">
                    <div className="stat-value">{(loginHistory ?? []).length}</div>
                    <div className="stat-label">Recorded Sign-In Attempts</div>
                  </div>
                </div>
              </div>

              {failedLast24h >= 3 && (
                <div className="info-banner info-banner-danger" style={{ marginBottom: 16 }}>
                  ⚠ {failedLast24h} failed sign-in attempts on this account in the last 24 hours. If this wasn't you, change your password now.
                </div>
              )}

              <div className="card">
                <h3>Sign-In History</h3>
                {loginHistory === null ? (
                  <div className="empty-state">Loading…</div>
                ) : loginHistory.length === 0 ? (
                  <div className="empty-state">No sign-in attempts recorded yet.</div>
                ) : (
                  <table className="table">
                    <thead>
                      <tr><th>Result</th><th>Time</th></tr>
                    </thead>
                    <tbody>
                      {loginHistory.map((entry, i) => (
                        <tr key={i}>
                          <td><span className={`pill ${entry.success ? 'pill-active' : 'pill-lapsed'}`} style={{ fontSize: '0.7rem' }}>{entry.success ? 'Success' : 'Failed'}</span></td>
                          <td className="mono" style={{ fontSize: '0.8rem' }}>{formatDateTime(entry.ts)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
