import { useEffect, useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { db } from '../../lib/db'
import type { SidebarCounts } from '../../lib/db'
import type { ActivePanel } from '../../App'
import Copyright from './Copyright'

interface SidebarProps {
  activePanel: ActivePanel
  setActivePanel: (panel: ActivePanel) => void
  isOpen: boolean
  onClose: () => void
}

interface NavItem {
  id: ActivePanel
  label: string
  icon: string
  badge?: number | string
  roles?: string[]
}

/** A collapsible bundle of related nav items — same pattern as the old
 *  one-off "Policies & Products" group, generalized so any section can fold
 *  several closely-related pages under one row instead of listing them
 *  flat. Keeps the sidebar scannable now that there are 25+ pages. */
interface NavGroup {
  groupId: string
  label: string
  icon: string
  items: NavItem[]
}

type NavEntry = NavItem | NavGroup

function isGroup(entry: NavEntry): entry is NavGroup {
  return 'groupId' in entry
}

interface NavSection {
  label: string
  items: NavEntry[]
}

const STAFF_SECTIONS: NavSection[] = [
  {
    label: 'MAIN',
    items: [
      { id: 'dashboard', label: 'Dashboard', icon: '⊞' },
      { id: 'claims', label: 'Claims', icon: '📋' },
      { id: 'payments', label: 'Payments', icon: '💳' },
      { id: 'agriculture_insurance', label: 'Agriculture Insurance', icon: '🌾', roles: ['super_admin', 'admin', 'policy_admin', 'claims_officer'] },
      {
        groupId: 'policies_products',
        label: 'Policies & Products',
        icon: '🛡',
        items: [
          { id: 'policies', label: 'Policies', icon: '🛡' },
          { id: 'products', label: 'Products', icon: '📦', roles: ['super_admin', 'admin', 'policy_admin'] },
          { id: 'pre_loss_assessments', label: 'Pre-Loss Assessments', icon: '🌾', roles: ['super_admin', 'admin', 'policy_admin', 'claims_officer'] },
          { id: 'insurer_management', label: 'Insurer Management', icon: '🏢', roles: ['super_admin', 'admin'] },
        ],
      },
    ],
  },
  {
    label: 'CLIENT MANAGEMENT',
    items: [
      { id: 'clients', label: 'Clients', icon: '👥' },
      { id: 'member_cards', label: 'Membership IDs', icon: '🪪', roles: ['super_admin', 'admin', 'policy_admin', 'claims_officer', 'finance'] },
      { id: 'leads', label: 'Leads & Marketing', icon: '🎯', badge: 'AI' },
    ],
  },
  {
    label: 'OPERATIONS',
    items: [
      { id: 'staff', label: 'Staff', icon: '✅', roles: ['super_admin', 'admin'] },
      { id: 'reports', label: 'Reports', icon: '📊', roles: ['super_admin', 'admin', 'finance'] },
      {
        groupId: 'communications',
        label: 'Communications',
        icon: '✉',
        items: [
          { id: 'email', label: 'Email', icon: '✉' },
          { id: 'tickets', label: 'Tickets', icon: '💬' },
          { id: 'live_chat', label: 'Live Chat', icon: '🟢', roles: ['super_admin', 'admin', 'client_relations'] },
          { id: 'mass_messaging', label: 'Bulk SMS Messaging', icon: '📱', roles: ['super_admin', 'admin'] },
        ],
      },
      {
        groupId: 'billing',
        label: 'Billing & Reminders',
        icon: '💳',
        items: [
          { id: 'reminders', label: 'Reminders', icon: '🔔' },
          { id: 'billing_reminders', label: 'Billing & Reminders', icon: '💳', roles: ['super_admin', 'admin', 'finance'] },
        ],
      },
    ],
  },
  {
    label: 'INTEGRATIONS',
    items: [
      // NetOne Integration nav entry removed while the partnership is
      // suspended — the page and route are untouched, just unreachable
      // from the sidebar. Restore this line to bring it back.
      // { id: 'mno_integration', label: 'NetOne Integration', icon: '📡', roles: ['super_admin', 'admin'] },
      { id: 'fraud', label: 'Fraud Detection', icon: '⚠', roles: ['super_admin', 'admin', 'claims_officer'] },
      { id: 'developer_api', label: 'Developers and API', icon: '🔌', roles: ['super_admin', 'admin'] },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { id: 'profile', label: 'My Profile', icon: '👤' },
      {
        groupId: 'administration',
        label: 'Administration',
        icon: '⚙',
        items: [
          { id: 'system_access_roles', label: 'System Access Roles', icon: '🔐', roles: ['super_admin'] },
          { id: 'system_health', label: 'System Health', icon: '🖥', roles: ['super_admin', 'admin'] },
          { id: 'settings', label: 'Settings', icon: '⚙', roles: ['super_admin', 'admin'] },
        ],
      },
    ],
  },
]

const BADGE_COUNT_KEYS: Partial<Record<ActivePanel, keyof SidebarCounts>> = {
  policies: 'policies',
  claims: 'claimsPending',
  clients: 'clients',
  reminders: 'remindersDue',
  email: 'emailUnread',
  tickets: 'ticketsOpen',
  live_chat: 'chatQueued',
}

const CLIENT_NAV: NavItem[] = [
  { id: 'my_policies', label: 'My Policies', icon: '🛡' },
  { id: 'my_claims', label: 'My Claims', icon: '📋' },
  { id: 'my_payments', label: 'My Payments', icon: '💳' },
  { id: 'profile', label: 'My Profile', icon: '👤' },
]

export default function Sidebar({ activePanel, setActivePanel, isOpen, onClose }: SidebarProps) {
  const { user, canAccess } = useAuth()
  const [counts, setCounts] = useState<SidebarCounts | null>(null)
  // Whichever group contains the current page starts open; the rest start
  // collapsed. Track open groups by id so any number of groups can be
  // expanded independently instead of one bespoke boolean per group.
  const [openGroups, setOpenGroups] = useState<Set<string>>(() => {
    const initial = new Set<string>()
    for (const section of STAFF_SECTIONS) {
      for (const entry of section.items) {
        if (isGroup(entry) && entry.items.some(i => i.id === activePanel)) initial.add(entry.groupId)
      }
    }
    return initial
  })
  const toggleGroup = (groupId: string) => {
    setOpenGroups(prev => {
      const next = new Set(prev)
      if (next.has(groupId)) next.delete(groupId)
      else next.add(groupId)
      return next
    })
  }

  useEffect(() => {
    if (!user || user.role === 'policyholder') return
    const load = () => { db.sidebarCounts.load().then(setCounts) }
    load()
    const interval = setInterval(load, 60000)
    return () => clearInterval(interval)
  }, [user])

  if (!user) return null

  const isClient = user.role === 'policyholder'

  if (isClient) {
    const visible = CLIENT_NAV.filter(item => canAccess(item.id))
    return (
      <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
        <SidebarHeader onClose={onClose} />
        <nav className="sidebar-nav">
          {visible.map(item => (
            <NavBtn key={item.id} item={item} active={activePanel === item.id} onClick={() => setActivePanel(item.id)} />
          ))}
        </nav>
        <SidebarFooter user={user} />
      </aside>
    )
  }

  const badgeFor = (item: NavItem) => {
    const countKey = BADGE_COUNT_KEYS[item.id]
    const liveBadge = countKey && counts ? counts[countKey] : undefined
    return liveBadge !== undefined ? (liveBadge > 0 ? liveBadge : undefined) : item.badge
  }
  const itemAllowed = (item: NavItem) => {
    if (item.roles && !item.roles.includes(user.role)) return false
    return canAccess(item.id)
  }

  return (
    <aside className={`sidebar${isOpen ? ' sidebar-open' : ''}`}>
      <SidebarHeader onClose={onClose} />
      <nav className="sidebar-nav">
        {STAFF_SECTIONS.map(section => {
          const visibleEntries = section.items
            .map((entry): NavEntry | null => {
              if (isGroup(entry)) {
                const visibleItems = entry.items.filter(itemAllowed)
                return visibleItems.length > 0 ? { ...entry, items: visibleItems } : null
              }
              return itemAllowed(entry) ? entry : null
            })
            .filter((e): e is NavEntry => e !== null)
          if (!visibleEntries.length) return null
          return (
            <div key={section.label}>
              <span className="nav-sec">{section.label}</span>
              {visibleEntries.map(entry => {
                if (isGroup(entry)) {
                  const open = openGroups.has(entry.groupId)
                  return (
                    <div key={entry.groupId}>
                      <button
                        type="button"
                        className={`nav-item${entry.items.some(i => i.id === activePanel) ? ' active' : ''}`}
                        onClick={() => toggleGroup(entry.groupId)}
                      >
                        <span className="nav-icon">{entry.icon}</span>
                        <span className="nav-label">{entry.label}</span>
                        <span style={{ fontSize: 10, opacity: 0.6 }}>{open ? '▾' : '▸'}</span>
                      </button>
                      {open && entry.items.map(item => (
                        <div key={item.id} style={{ paddingLeft: 16 }}>
                          <NavBtn item={{ ...item, badge: badgeFor(item) }} active={activePanel === item.id} onClick={() => setActivePanel(item.id)} />
                        </div>
                      ))}
                    </div>
                  )
                }
                return (
                  <NavBtn key={entry.id} item={{ ...entry, badge: badgeFor(entry) }} active={activePanel === entry.id} onClick={() => setActivePanel(entry.id)} />
                )
              })}
            </div>
          )
        })}
      </nav>
      <SidebarFooter user={user} />
    </aside>
  )
}

function SidebarHeader({ onClose }: { onClose: () => void }) {
  return (
    <div className="sidebar-logo">
      <div className="sidebar-logo-mark">T</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="sidebar-logo-name">ENPASENT IMS</div>
        <div className="sidebar-logo-sub">Enpasent Multiple Agent</div>
      </div>
      <button className="sidebar-close-btn" onClick={onClose} aria-label="Close sidebar">✕</button>
    </div>
  )
}

function SidebarFooter({ user }: { user: { name: string; role: string } }) {
  return (
    <>
      <div className="sidebar-user">
        <div className="sidebar-user-avatar">{user.name.charAt(0)}</div>
        <div className="sidebar-user-info">
          <div className="sidebar-user-name">{user.name}</div>
          <div className="sidebar-user-role">{user.role.replace(/_/g, ' ')}</div>
        </div>
      </div>
      <Copyright />
    </>
  )
}

function NavBtn({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`nav-item${active ? ' active' : ''}`}
      onClick={onClick}
    >
      <span className="nav-icon">{item.icon}</span>
      <span className="nav-label">{item.label}</span>
      {item.badge !== undefined ? <span className="nav-badge">{item.badge}</span> : null}
    </button>
  )
}
