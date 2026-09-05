import type { ActivePanel } from '../../App'

interface Props {
  activePanel: ActivePanel
  setActivePanel: (panel: ActivePanel) => void
}

/**
 * Mobile-only bottom tab bar for the policyholder portal — a second,
 * always-visible way to move around on a phone, alongside the sidebar
 * (which still opens via the hamburger menu; this doesn't replace it).
 * Hidden above 768px in index.css, where the sidebar is already visible.
 *
 * The center tab is deliberately bigger and always styled as active: there
 * is no separate policyholder "Dashboard" page yet, so it lands on the same
 * page as the Policies tab (their existing landing page) rather than
 * inventing a new one — see the two "policies" entries below.
 */
const TABS: { id: ActivePanel; label: string; icon: string }[] = [
  { id: 'my_claims', label: 'Claims', icon: '📋' },
  { id: 'my_policies', label: 'Policies', icon: '🛡' },
  { id: 'my_policies', label: 'Dashboard', icon: '⊞' },
  { id: 'my_payments', label: 'Payments', icon: '💳' },
  { id: 'profile', label: 'Profile', icon: '👤' },
]

export default function MobileTabBar({ activePanel, setActivePanel }: Props) {
  return (
    <nav className="mobile-tab-bar">
      {TABS.map((tab, i) => {
        const isCenter = i === 2
        return (
          <button
            key={`${tab.id}-${i}`}
            type="button"
            className={`mobile-tab-item${isCenter ? ' mobile-tab-center' : ''}${!isCenter && activePanel === tab.id ? ' active' : ''}`}
            onClick={() => setActivePanel(tab.id)}
          >
            <span className="mobile-tab-icon">{tab.icon}</span>
            <span className="mobile-tab-label">{tab.label}</span>
          </button>
        )
      })}
    </nav>
  )
}
