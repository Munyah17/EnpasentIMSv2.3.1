import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import type { ActivePanel } from '../../App'
import type { ToastMessage } from '../../types'

interface TopBarProps {
  activePanel: ActivePanel
  onMenuToggle: () => void
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

const PANEL_TITLES: Record<ActivePanel, string> = {
  dashboard: 'Dashboard',
  policies: 'Policies',
  claims: 'Claims',
  payments: 'Payments',
  products: 'Products',
  clients: 'Clients',
  staff: 'Staff',
  reminders: 'Reminders',
  reports: 'Reports',
  leads: 'Leads & Marketing',
  email: 'Email',
  tickets: 'Support Tickets',
  live_chat: 'Live Chat',
  fraud: 'Fraud Detection',
  mno_integration: 'NetOne Integration',
  system_health: 'System Health',
  settings: 'Settings',
  developer_api: 'Developers and API',
  mass_messaging: 'Bulk SMS Messaging',
  billing_reminders: 'Billing & Reminders',
  pre_loss_assessments: 'Pre-Loss Assessments',
  member_cards: 'Membership IDs',
  insurer_management: 'Insurer Management',
  agriculture_insurance: 'Agriculture Insurance',
  system_access_roles: 'System Access Roles',
  profile: 'My Profile',
  my_policies: 'My Policies',
  my_claims: 'My Claims',
  my_payments: 'My Payments',
}

export default function TopBar({ activePanel, onMenuToggle, showToast }: TopBarProps) {
  const { user, logout } = useAuth()
  const [showDropdown, setShowDropdown] = useState(false)
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false)

  const today = new Date().toLocaleDateString('en-GB', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })

  const handleLogout = () => {
    setShowDropdown(false)
    setShowLogoutConfirm(true)
  }

  const confirmLogout = () => {
    showToast('info', 'Signed out successfully.')
    setTimeout(logout, 500)
  }

  return (
    <>
      <header className="topbar">
        <div className="topbar-left">
          <button className="menu-toggle" onClick={onMenuToggle} aria-label="Toggle menu">
            ☰
          </button>
          <div>
            <h1 className="topbar-title">{PANEL_TITLES[activePanel]}</h1>
            <p className="topbar-date">{today}</p>
          </div>
        </div>

        <div className="topbar-right">
          <div className="topbar-profile" onClick={() => setShowDropdown(o => !o)}>
            <div className="topbar-avatar">{user?.name.charAt(0)}</div>
            <div className="topbar-user-info">
              <span className="topbar-user-name">{user?.name}</span>
              <span className="topbar-user-role">{user?.role.replace(/_/g, ' ')}</span>
            </div>
            <span className="topbar-chevron">{showDropdown ? '▲' : '▼'}</span>
          </div>

          {showDropdown && (
            <>
              <div className="dropdown-backdrop" onClick={() => setShowDropdown(false)} />
              <div className="profile-dropdown">
                <div className="dropdown-header">
                  <strong>{user?.name}</strong>
                  <span>{user?.email}</span>
                </div>
                <div className="dropdown-divider" />
                <button className="dropdown-item" onClick={() => setShowDropdown(false)}>
                  👤 My Profile
                </button>
                <button className="dropdown-item danger" onClick={handleLogout}>
                  ⏻ Sign Out
                </button>
              </div>
            </>
          )}
        </div>
      </header>

      {showLogoutConfirm && (
        <div className="modal-overlay">
          <div className="modal" style={{ maxWidth: 380 }}>
            <div className="modal-header">
              <h3>Sign Out</h3>
            </div>
            <div className="modal-body">
              <p>Are you sure you want to sign out of Tariqify IMS?</p>
            </div>
            <div className="modal-footer">
              <button className="btn btn-ghost" onClick={() => setShowLogoutConfirm(false)}>Cancel</button>
              <button className="btn btn-danger" onClick={confirmLogout}>Sign Out</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
