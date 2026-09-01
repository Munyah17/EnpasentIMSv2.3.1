import { useCallback, useEffect, useRef, useState } from 'react'
import { stampJpegExif } from '../../lib/exifWriter'

/**
 * The Camera button, on every device.
 *
 * A file input with `capture="environment"` only opens a camera on phones and
 * tablets; every desktop and laptop browser ignores the attribute and shows
 * a file picker, which made Camera and Gallery the same button on half the
 * fleet. This opens the camera itself via getUserMedia — laptops, phones,
 * tablets, iPad, Android alike — shows a live viewfinder, and returns the
 * frame the assessor actually framed.
 *
 * The captured frame is stamped with real Exif (see lib/exifWriter.ts) so it
 * carries its own capture time, the same evidence a phone camera file would.
 *
 * If the camera genuinely can't be opened — permission denied, no camera, or
 * an embedded browser that blocks getUserMedia — it falls back to the
 * device's own camera app rather than dead-ending.
 */

interface Props {
  label: string
  onCapture: (file: File) => void
  onClose: () => void
  /** Hands off to the OS camera app (a `capture` file input) when the
   *  in-page camera can't run on this device/browser. */
  onUseDeviceCamera: () => void
}

type Phase = 'starting' | 'live' | 'review' | 'error'

/** Highest resolution the browser will give us, so a leaf count or a barn
 *  interior is still legible when a reviewer zooms in. */
const IDEAL: MediaTrackConstraints = { width: { ideal: 3840 }, height: { ideal: 2160 } }

export default function CameraCapture({ label, onCapture, onClose, onUseDeviceCamera }: Props) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const [phase, setPhase] = useState<Phase>('starting')
  const [error, setError] = useState('')
  const [facing, setFacing] = useState<'environment' | 'user'>('environment')
  const [hasMultipleCameras, setHasMultipleCameras] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [torchAvailable, setTorchAvailable] = useState(false)
  const [shot, setShot] = useState<{ url: string; file: File } | null>(null)
  const [working, setWorking] = useState(false)

  const stopStream = useCallback(() => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }, [])

  const start = useCallback(async (want: 'environment' | 'user') => {
    stopStream()
    setPhase('starting')
    setError('')

    if (!navigator.mediaDevices?.getUserMedia) {
      setError(
        window.isSecureContext === false
          ? 'This browser only allows the camera on a secure (https) connection.'
          : "This browser doesn't support opening the camera in-page.",
      )
      setPhase('error')
      return
    }

    // Ask for the requested camera, but never fail outright because a device
    // has only one: a laptop has no "environment" camera and would otherwise
    // reject the constraint entirely.
    const attempts: MediaStreamConstraints[] = [
      { video: { facingMode: { exact: want }, ...IDEAL }, audio: false },
      { video: { facingMode: { ideal: want }, ...IDEAL }, audio: false },
      { video: IDEAL, audio: false },
      { video: true, audio: false },
    ]

    let stream: MediaStream | null = null
    let lastError: unknown = null
    for (const constraints of attempts) {
      try {
        stream = await navigator.mediaDevices.getUserMedia(constraints)
        break
      } catch (e) {
        lastError = e
        // A refusal is the user's answer, not a constraint problem — asking
        // again with looser constraints just prompts them repeatedly.
        const name = (e as DOMException)?.name
        if (name === 'NotAllowedError' || name === 'SecurityError') break
      }
    }

    if (!stream) {
      const name = (lastError as DOMException)?.name
      setError(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera access was blocked. Allow camera for this site in your browser settings (the padlock in the address bar), then try again.'
          : name === 'NotFoundError' || name === 'DevicesNotFoundError'
            ? 'No camera was found on this device.'
            : name === 'NotReadableError'
              ? 'The camera is already in use by another app. Close it and try again.'
              : 'Could not open the camera on this device.',
      )
      setPhase('error')
      return
    }

    streamRef.current = stream
    if (videoRef.current) {
      videoRef.current.srcObject = stream
      // iOS won't autoplay an inline stream without an explicit play().
      try { await videoRef.current.play() } catch { /* the poster frame still shows */ }
    }

    const track = stream.getVideoTracks()[0]
    const caps = track?.getCapabilities?.() as (MediaTrackCapabilities & { torch?: boolean }) | undefined
    setTorchAvailable(!!caps?.torch)
    setTorchOn(false)
    setPhase('live')

    // Only offer the flip control where there is something to flip to.
    try {
      const devices = await navigator.mediaDevices.enumerateDevices()
      setHasMultipleCameras(devices.filter(d => d.kind === 'videoinput').length > 1)
    } catch { /* the control simply stays hidden */ }
  }, [stopStream])

  useEffect(() => {
    void start(facing)
    return () => stopStream()
    // Restarting on `facing` is the flip: the effect tears the old stream down.
  }, [facing, start, stopStream])

  useEffect(() => () => { if (shot) URL.revokeObjectURL(shot.url) }, [shot])

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0]
    if (!track) return
    const next = !torchOn
    try {
      await track.applyConstraints({ advanced: [{ torch: next } as MediaTrackConstraintSet] })
      setTorchOn(next)
    } catch { setTorchAvailable(false) }
  }

  const takeShot = async () => {
    const video = videoRef.current
    if (!video || !video.videoWidth) return
    setWorking(true)

    const canvas = document.createElement('canvas')
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    const ctx = canvas.getContext('2d')
    if (!ctx) { setWorking(false); return }
    // The front camera preview is mirrored because that is what people
    // expect to see; the saved frame is not, so the photo is a record of
    // the scene rather than of the preview.
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.92))
    if (!blob) { setWorking(false); return }

    const takenAt = new Date()
    const track = streamRef.current?.getVideoTracks()[0]
    const stamped = await stampJpegExif(blob, {
      taken: takenAt,
      make: navigator.platform || 'Web',
      model: track?.label?.trim() || `${facing === 'user' ? 'Front' : 'Rear'} camera`,
      software: 'Tariqify IMS Live Capture',
    })

    const safeLabel = label.replace(/[^a-z0-9]+/gi, '-').toLowerCase()
    const file = new File([stamped], `capture-${safeLabel}-${takenAt.getTime()}.jpg`, {
      type: 'image/jpeg',
      lastModified: takenAt.getTime(),
    })
    setShot({ url: URL.createObjectURL(stamped), file })
    setPhase('review')
    setWorking(false)
  }

  const retake = () => {
    if (shot) URL.revokeObjectURL(shot.url)
    setShot(null)
    setPhase('live')
  }

  const use = () => {
    if (!shot) return
    stopStream()
    onCapture(shot.file)
  }

  const close = () => { stopStream(); onClose() }

  return (
    <div className="camera-overlay" role="dialog" aria-label={`Camera: ${label}`}>
      <div className="camera-topbar">
        <span className="camera-title">{label}</span>
        <button type="button" className="camera-icon-btn" onClick={close} aria-label="Close camera">✕</button>
      </div>

      <div className="camera-stage">
        <video
          ref={videoRef}
          className={`camera-video${facing === 'user' ? ' mirrored' : ''}${phase === 'review' ? ' hidden' : ''}`}
          playsInline
          muted
          autoPlay
        />
        {phase === 'review' && shot && <img src={shot.url} alt={`Captured ${label}`} className="camera-shot" />}
        {phase === 'starting' && <div className="camera-status">Opening camera…</div>}
        {phase === 'error' && (
          <div className="camera-status camera-status-error">
            <div style={{ fontSize: 30, marginBottom: 10 }}>📷</div>
            <p style={{ marginBottom: 14, maxWidth: 340 }}>{error}</p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
              <button type="button" className="btn btn-outline btn-sm" onClick={() => void start(facing)}>Try again</button>
              <button type="button" className="btn btn-primary btn-sm" onClick={() => { stopStream(); onUseDeviceCamera() }}>
                Use my device's camera app
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="camera-controls">
        {phase === 'live' && (
          <>
            <button
              type="button"
              className="camera-icon-btn"
              onClick={toggleTorch}
              disabled={!torchAvailable}
              aria-label="Toggle flash"
              title={torchAvailable ? 'Flash' : 'No flash on this camera'}
            >
              {torchOn ? '🔦' : '💡'}
            </button>
            <button type="button" className="camera-shutter" onClick={takeShot} disabled={working} aria-label="Take photo">
              <span className="camera-shutter-inner" />
            </button>
            <button
              type="button"
              className="camera-icon-btn"
              onClick={() => setFacing(f => (f === 'environment' ? 'user' : 'environment'))}
              disabled={!hasMultipleCameras}
              aria-label="Switch camera"
              title={hasMultipleCameras ? 'Switch camera' : 'Only one camera on this device'}
            >
              🔄
            </button>
          </>
        )}
        {phase === 'review' && (
          <div className="camera-review-actions">
            <button type="button" className="btn btn-ghost" onClick={retake}>Retake</button>
            <button type="button" className="btn btn-primary" onClick={use}>Use this photo</button>
          </div>
        )}
      </div>
    </div>
  )
}
