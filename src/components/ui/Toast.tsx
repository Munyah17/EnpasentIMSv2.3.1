import type { ToastMessage } from '../../types'

interface ToastProps {
  toasts: ToastMessage[]
  onDismiss: (id: string) => void
}

const ICONS: Record<ToastMessage['type'], string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'ℹ',
}

export default function Toast({ toasts, onDismiss }: ToastProps) {
  if (toasts.length === 0) return null
  return (
    <div className="toast-container">
      {toasts.map(t => (
        <div key={t.id} className={`toast toast-${t.type}`}>
          <span className="toast-icon">{ICONS[t.type]}</span>
          <span className="toast-message">{t.message}</span>
          <button className="toast-close" onClick={() => onDismiss(t.id)}>✕</button>
        </div>
      ))}
    </div>
  )
}
