import { useEffect, useRef, useState } from 'react'

export interface ActionMenuItem {
  label: string
  onClick: () => void
  danger?: boolean
  hidden?: boolean
}

interface Props {
  items: ActionMenuItem[]
}

/** Compact kebab-menu trigger for table row actions. Keeps every action
 *  available (nothing removed) while replacing a row of buttons that
 *  otherwise crowds narrow table cells. */
export default function ActionMenu({ items }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDocClick)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDocClick)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const visible = items.filter(i => !i.hidden)

  return (
    <div className="action-menu" ref={ref}>
      <button
        type="button"
        className="action-menu-trigger"
        aria-label="Row actions"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        ⋮
      </button>
      {open && (
        <div className="action-menu-dropdown" role="menu">
          {visible.map((item, i) => (
            <button
              key={i}
              type="button"
              role="menuitem"
              className={`action-menu-item${item.danger ? ' danger' : ''}`}
              onClick={() => { setOpen(false); item.onClick() }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
