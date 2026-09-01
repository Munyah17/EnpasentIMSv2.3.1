import { useEffect, useRef, useState } from 'react'

/**
 * Reads a card at the service desk.
 *
 * A USB RFID reader is a keyboard as far as the browser is concerned: tap a
 * card and it types the tag number and presses Enter. So this is simply a
 * focused input that submits on Enter — no drivers, no pairing, and it
 * works with any reader the office happens to buy. The number can also just
 * be typed in when a card is being checked over the phone.
 */

interface Props {
  onClose: () => void
  onScanned: (tag: string) => void
}

export default function RfidScanModal({ onClose, onScanned }: Props) {
  const [tag, setTag] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  // The reader "types" wherever the focus is, so the field has to hold it.
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = () => {
    const value = tag.trim()
    if (value) onScanned(value)
  }

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ maxWidth: 460 }}>
        <div className="modal-header">
          <h3>Scan Membership Card</h3>
          <button className="modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div style={{ textAlign: 'center', padding: '8px 0 4px', fontSize: 40 }}>📡</div>
          <p style={{ textAlign: 'center', fontSize: 13, color: 'var(--muted)', marginBottom: 4 }}>
            Tap the card on the reader. The number appears below on its own.
          </p>
          <div className="form-group">
            <label>Card Serial</label>
            <input
              ref={inputRef}
              className="form-control mono"
              value={tag}
              onChange={e => setTag(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
              placeholder="Waiting for a card…"
              onBlur={() => inputRef.current?.focus()}
            />
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" onClick={submit} disabled={!tag.trim()}>Look Up</button>
        </div>
      </div>
    </div>
  )
}
