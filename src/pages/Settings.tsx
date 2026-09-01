import { useState } from 'react'
import type { ToastMessage } from '../types'
import type { ActivePanel } from '../App'
import NotificationSettings from './NotificationSettings'
import CommissionSettings from '../components/settings/CommissionSettings'
import HeroSliderSettings from '../components/settings/HeroSliderSettings'

interface Props {
  showToast: (type: ToastMessage['type'], message: string) => void
  setActivePanel: (panel: ActivePanel) => void
}

type SettingsTab = 'notifications' | 'commission' | 'website'

export default function Settings(props: Props) {
  const [tab, setTab] = useState<SettingsTab>('notifications')

  return (
    <div className="panel">
      <div className="tabs" style={{ marginBottom: 16 }}>
        <button className={`tab${tab === 'notifications' ? ' active' : ''}`} onClick={() => setTab('notifications')}>
          Notifications
        </button>
        <button className={`tab${tab === 'commission' ? ' active' : ''}`} onClick={() => setTab('commission')}>
          Agent Commission
        </button>
        <button className={`tab${tab === 'website' ? ' active' : ''}`} onClick={() => setTab('website')}>
          Website Content
        </button>
      </div>
      <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 16 }}>
        Payment gateway credentials (EcoCash/Paynow/Zipit) live under <b>Billing &amp; Reminders</b>, and the SMS gateway lives under <b>Bulk SMS Messaging</b>, kept there since they sit next to where they're used.
      </p>
      {tab === 'notifications' && <NotificationSettings {...props} />}
      {tab === 'commission' && <CommissionSettings showToast={props.showToast} />}
      {tab === 'website' && <HeroSliderSettings showToast={props.showToast} />}
    </div>
  )
}
