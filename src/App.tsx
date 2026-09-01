import { useState, useEffect, useCallback, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { startReminderEngine } from './lib/reminderEngine'
import { initNotifSettings } from './lib/mailService'
import { startOfflineSync } from './lib/offlineQueue'
import { DB_FALLBACK_EVENT } from './lib/db'
import { lazyWithRecovery } from './lib/lazyWithRecovery'
import { AuthProvider, useAuth } from './contexts/AuthContext'
import LoginScreen from './components/Auth/LoginScreen'
import SuperAdminLogin from './components/Auth/SuperAdminLogin'
import AdminLogin from './components/Auth/AdminLogin'
import Sidebar from './components/Layout/Sidebar'
import TopBar from './components/Layout/TopBar'
import Toast from './components/ui/Toast'
import SystemHealth from './components/ui/SystemHealth'
import ChatWidget from './components/chat/ChatWidget'
import type { ToastMessage } from './types'

// Route-split: each page becomes its own chunk, fetched on first visit
// (and cached by the browser/CDN after) instead of all ~20 pages riding
// in one bundle every user downloads just to see the login screen.
const Dashboard = lazyWithRecovery('Dashboard', () => import('./pages/Dashboard'))
const Policies = lazyWithRecovery('Policies', () => import('./pages/Policies'))
const Claims = lazyWithRecovery('Claims', () => import('./pages/Claims'))
const Payments = lazyWithRecovery('Payments', () => import('./pages/Payments'))
const Products = lazyWithRecovery('Products', () => import('./pages/Products'))
const Clients = lazyWithRecovery('Clients', () => import('./pages/Clients'))
const Staff = lazyWithRecovery('Staff', () => import('./pages/Staff'))
const SystemAccessRoles = lazyWithRecovery('SystemAccessRoles', () => import('./pages/SystemAccessRoles'))
const Reminders = lazyWithRecovery('Reminders', () => import('./pages/Reminders'))
const Reports = lazyWithRecovery('Reports', () => import('./pages/Reports'))
const Leads = lazyWithRecovery('Leads', () => import('./pages/Leads'))
const Email = lazyWithRecovery('Email', () => import('./pages/Email'))
const Tickets = lazyWithRecovery('Tickets', () => import('./pages/Tickets'))
const Fraud = lazyWithRecovery('Fraud', () => import('./pages/Fraud'))
const Profile = lazyWithRecovery('Profile', () => import('./pages/Profile'))
const MnoIntegration = lazyWithRecovery('MnoIntegration', () => import('./pages/MnoIntegration'))
const SystemHealthPage = lazyWithRecovery('SystemHealthPage', () => import('./pages/SystemHealthPage'))
const Settings = lazyWithRecovery('Settings', () => import('./pages/Settings'))
const DeveloperApi = lazyWithRecovery('DeveloperApi', () => import('./pages/DeveloperApi'))
const MassMessaging = lazyWithRecovery('MassMessaging', () => import('./pages/MassMessaging'))
const BillingReminders = lazyWithRecovery('BillingReminders', () => import('./pages/BillingReminders'))
const PreLossAssessments = lazyWithRecovery('PreLossAssessments', () => import('./pages/PreLossAssessments'))
const InsurerManagement = lazyWithRecovery('InsurerManagement', () => import('./pages/InsurerManagement'))
const AgricultureInsurance = lazyWithRecovery('AgricultureInsurance', () => import('./pages/AgricultureInsurance'))
const MemberCards = lazyWithRecovery('MemberCards', () => import('./pages/MemberCards'))
const MyPolicies = lazyWithRecovery('MyPolicies', () => import('./pages/policyholder/MyPolicies'))
const MyClaims = lazyWithRecovery('MyClaims', () => import('./pages/policyholder/MyClaims'))
const MyPayments = lazyWithRecovery('MyPayments', () => import('./pages/policyholder/MyPayments'))
const LiveChat = lazyWithRecovery('LiveChat', () => import('./pages/LiveChat'))

export type ActivePanel =
  | 'dashboard' | 'policies' | 'claims' | 'payments' | 'products'
  | 'clients' | 'staff' | 'system_access_roles' | 'reminders' | 'reports' | 'leads'
  | 'email' | 'tickets' | 'fraud' | 'profile' | 'mno_integration'
  | 'system_health' | 'settings' | 'developer_api' | 'mass_messaging' | 'billing_reminders' | 'pre_loss_assessments' | 'insurer_management' | 'agriculture_insurance' | 'member_cards'
  | 'my_policies' | 'my_claims' | 'my_payments' | 'live_chat'

function AppInner() {
  const { user, loading } = useAuth()
  const [activePanel, setActivePanelRaw] = useState<ActivePanel>(() =>
    user?.role === 'policyholder' ? 'my_policies' : 'dashboard'
  )
  // Lets a page hand the next one a starting filter, so "View Agriculture
  // Policies" from the Agriculture view opens Policies already narrowed to
  // agriculture instead of showing the whole book.
  const [panelCategory, setPanelCategory] = useState<string | undefined>(undefined)
  const setActivePanel = useCallback((panel: ActivePanel, category?: string) => {
    setPanelCategory(category)
    setActivePanelRaw(panel)
  }, [])

  useEffect(() => {
    void initNotifSettings()
    const stopReminders = startReminderEngine()
    const stopOfflineSync = startOfflineSync()
    return () => { stopReminders(); stopOfflineSync() }
  }, [])
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [toasts, setToasts] = useState<ToastMessage[]>([])

  // Stable references: 11 pages use `[showToast]` as a data-fetch effect
  // dependency. An inline function here would be recreated on every render
  // of AppInner (e.g. whenever ANY toast anywhere appears or auto-dismisses),
  // which would re-trigger every mounted page's fetch and silently overwrite
  // any not-yet-persisted local state — including a just-added item.
  const showToast = useCallback((type: ToastMessage['type'], message: string) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    setToasts(prev => [...prev, { id, type, message }])
    // Stays up to 15s so it's actually readable — the user can also close
    // it early via the toast's own dismiss button (see Toast.tsx).
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 15000)
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id))
  }, [])

  useEffect(() => {
    let lastReadWarningAt = 0
    let lastWriteWarningAt = 0
    const onFallback = (e: Event) => {
      const { type } = (e as CustomEvent<{ table: string; type: 'read' | 'write' | 'delete' }>).detail
      const now = Date.now()
      if (type === 'read') {
        if (now - lastReadWarningAt < 8000) return
        lastReadWarningAt = now
        showToast('warning', 'Could not reach the server, showing locally cached data. Some records may be out of date.')
      } else {
        if (now - lastWriteWarningAt < 8000) return
        lastWriteWarningAt = now
        showToast('warning', 'Could not reach the server; your change was saved locally only and has NOT synced yet.')
      }
    }
    window.addEventListener(DB_FALLBACK_EVENT, onFallback)
    return () => window.removeEventListener(DB_FALLBACK_EVENT, onFallback)
  }, [])

  if (loading || !user) return null

  const panelProps = { showToast, setActivePanel }

  const renderPanel = () => {
    switch (activePanel) {
      case 'dashboard': return <Dashboard {...panelProps} />
      case 'policies': return <Policies {...panelProps} initialCategory={panelCategory} />
      case 'claims': return <Claims {...panelProps} initialCategory={panelCategory} />
      case 'payments': return <Payments {...panelProps} />
      case 'products': return <Products {...panelProps} />
      case 'clients': return <Clients {...panelProps} />
      case 'staff': return <Staff {...panelProps} />
      case 'system_access_roles': return <SystemAccessRoles {...panelProps} />
      case 'reminders': return <Reminders {...panelProps} />
      case 'reports': return <Reports {...panelProps} />
      case 'leads': return <Leads {...panelProps} />
      case 'email': return <Email {...panelProps} />
      case 'tickets': return <Tickets {...panelProps} />
      case 'fraud': return <Fraud {...panelProps} />
      case 'mno_integration': return <MnoIntegration {...panelProps} />
      case 'system_health': return <SystemHealthPage {...panelProps} />
      case 'settings': return <Settings {...panelProps} />
      case 'developer_api': return <DeveloperApi {...panelProps} />
      case 'mass_messaging': return <MassMessaging {...panelProps} />
      case 'billing_reminders': return <BillingReminders {...panelProps} />
      case 'pre_loss_assessments': return <PreLossAssessments {...panelProps} />
      case 'insurer_management': return <InsurerManagement {...panelProps} />
      case 'agriculture_insurance': return <AgricultureInsurance {...panelProps} />
      case 'member_cards': return <MemberCards {...panelProps} />
      case 'profile': return <Profile {...panelProps} />
      case 'my_policies': return <MyPolicies {...panelProps} />
      case 'my_claims': return <MyClaims {...panelProps} />
      case 'my_payments': return <MyPayments {...panelProps} />
      case 'live_chat': return <LiveChat {...panelProps} />
      default: return <Dashboard {...panelProps} />
    }
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePanel={activePanel}
        setActivePanel={(panel) => { setActivePanel(panel); setSidebarOpen(false) }}
        isOpen={sidebarOpen}
        onClose={() => setSidebarOpen(false)}
      />
      {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}
      <div className="main-content">
        <TopBar
          activePanel={activePanel}
          onMenuToggle={() => setSidebarOpen(o => !o)}
          showToast={showToast}
          setActivePanel={setActivePanel}
        />
        <div className="content-area">
          <Suspense fallback={<div className="panel"><div className="empty-state">Loading…</div></div>}>
            {renderPanel()}
          </Suspense>
        </div>
      </div>
      <Toast toasts={toasts} onDismiss={dismissToast} />
      <SystemHealth />
      {user.role === 'policyholder' && (
        <ChatWidget prefill={{ name: user.name, phone: user.phone ?? '', email: user.email }} />
      )}
    </div>
  )
}

function AuthGate() {
  const { user, loading } = useAuth()

  if (loading) return <div className="app-loading">Loading…</div>

  return (
    <Routes>
      <Route path="/super-admin" element={user ? <Navigate to="/" replace /> : <SuperAdminLogin />} />
      <Route path="/admin" element={user ? <Navigate to="/" replace /> : <AdminLogin />} />
      <Route path="/*" element={user ? <AppInner /> : <LoginScreen />} />
    </Routes>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <AuthGate />
    </AuthProvider>
  )
}
