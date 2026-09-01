import { useRef, useState, useEffect } from 'react'

interface Props {
  label: string
  onChange: (dataUrl: string | undefined) => void
  /** Highlights the pad as a missing required entry after a rejected
   *  submit (see components/ui/ValidationSummary.tsx). */
  invalid?: boolean
}

/** Canvas-based signature capture — draw with mouse or touch, exported as a
 *  PNG data URL. No external library; a signature pad is simple enough to
 *  hand-roll and this keeps the bundle light. */
export default function SignaturePad({ label, onChange, invalid }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const drawing = useRef(false)
  const [hasSignature, setHasSignature] = useState(false)

  // The canvas's internal pixel buffer is sized from its actual rendered
  // width (not a fixed 360px) so it never overflows a narrow phone screen —
  // two of these sit side-by-side in a .form-row, which on mobile is well
  // under 360px per pad — and drawing coordinates line up correctly at
  // whatever size it's actually displayed at instead of only ever covering
  // part of the canvas.
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const ratio = window.devicePixelRatio || 1
      canvas.width = rect.width * ratio
      canvas.height = rect.height * ratio
      const ctx = canvas.getContext('2d')
      if (!ctx) return
      ctx.scale(ratio, ratio)
      ctx.lineWidth = 2
      ctx.lineCap = 'round'
      ctx.strokeStyle = '#0f1c2e'
    }
    resize()
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const getPoint = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect()
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }

  const start = (e: React.PointerEvent<HTMLCanvasElement>) => {
    e.preventDefault()
    drawing.current = true
    // Without capturing the pointer, a fast mouse stroke that briefly exits
    // the canvas bounds (very easy with quick cursive movement, especially
    // near the edges) stops receiving move events and fires pointerleave,
    // cutting the line short -- the signature comes out broken and needs
    // several attempts to get right. Touch doesn't show this because touch
    // input is implicitly captured by the browser already; mouse isn't.
    canvasRef.current!.setPointerCapture(e.pointerId)
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = getPoint(e)
    ctx.beginPath()
    ctx.moveTo(x, y)
  }

  const move = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    const ctx = canvasRef.current!.getContext('2d')!
    const { x, y } = getPoint(e)
    ctx.lineTo(x, y)
    ctx.stroke()
    setHasSignature(true)
  }

  const end = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current) return
    drawing.current = false
    try { canvasRef.current?.releasePointerCapture(e.pointerId) } catch { /**/ }
    onChange(canvasRef.current!.toDataURL('image/png'))
  }

  const clear = () => {
    const canvas = canvasRef.current!
    const ctx = canvas.getContext('2d')!
    const rect = canvas.getBoundingClientRect()
    ctx.clearRect(0, 0, rect.width, rect.height)
    setHasSignature(false)
    onChange(undefined)
  }

  return (
    <div className={`signature-pad${invalid ? ' field-invalid-block' : ''}`}>
      <label>{label}</label>
      <canvas
        ref={canvasRef}
        width={360}
        height={120}
        className="signature-pad-canvas"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={end}
        onPointerCancel={end}
      />
      <div className="signature-pad-actions">
        {hasSignature ? <span className="signature-pad-status">✓ Signed</span> : <span className="signature-pad-status muted">Sign above</span>}
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
      </div>
    </div>
  )
}
