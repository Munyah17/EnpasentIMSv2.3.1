import { useState, useEffect, useRef } from 'react'

interface Props {
  value: string
  onChange: (isoDate: string) => void
  disabled?: boolean
  className?: string
  id?: string
}

// Native <input type="date"> renders in whatever locale the browser/OS is
// set to (mm/dd/yyyy on a US-locale machine) — there is no HTML attribute
// to force a display format, so a text field with a dd/mm/yyyy mask is the
// only reliable way to guarantee British date order everywhere. The value
// contract stays ISO (yyyy-mm-dd) in and out, same as a native date input,
// so callers don't need to change how they store dates.
function isoToDisplay(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : ''
}

function displayToIso(display: string): string | null {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(display)
  if (!m) return null
  const [, d, mo, y] = m
  const day = Number(d), month = Number(mo), year = Number(y)
  const date = new Date(year, month - 1, day)
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return `${y}-${mo}-${d}`
}

export default function DateInput({ value, onChange, disabled, className, id }: Props) {
  const [text, setText] = useState(isoToDisplay(value))
  const pickerRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setText(isoToDisplay(value)) }, [value])

  const handleTextChange = (raw: string) => {
    const digits = raw.replace(/\D/g, '').slice(0, 8)
    let formatted = digits
    if (digits.length > 4) formatted = `${digits.slice(0, 2)}/${digits.slice(2, 4)}/${digits.slice(4)}`
    else if (digits.length > 2) formatted = `${digits.slice(0, 2)}/${digits.slice(2)}`
    setText(formatted)
    if (formatted === '') { onChange(''); return }
    const iso = displayToIso(formatted)
    if (iso) onChange(iso)
  }

  const openPicker = () => {
    if (disabled) return
    const el = pickerRef.current
    if (!el) return
    if (typeof el.showPicker === 'function') el.showPicker()
    else el.click()
  }

  return (
    <div className={`date-input${className ? ` ${className}` : ''}`}>
      <input
        id={id}
        type="text"
        inputMode="numeric"
        className="form-control date-input-text"
        placeholder="DD/MM/YYYY"
        value={text}
        onChange={e => handleTextChange(e.target.value)}
        disabled={disabled}
        maxLength={10}
      />
      <button type="button" className="date-input-icon-btn" tabIndex={-1} disabled={disabled} onClick={openPicker} aria-label="Open calendar">📅</button>
      <input
        ref={pickerRef}
        type="date"
        className="date-input-native"
        value={value}
        disabled={disabled}
        tabIndex={-1}
        onChange={e => onChange(e.target.value)}
      />
    </div>
  )
}
