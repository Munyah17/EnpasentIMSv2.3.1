/**
 * Says why a form won't submit, instead of a dead button.
 *
 * These forms used to compute a `canSubmit` boolean and disable the submit
 * button with it. Pressing a disabled button does nothing and explains
 * nothing — on a long assessment form, with a required field somewhere above
 * the fold, that is indistinguishable from the app being broken. So the
 * button stays live, the attempt is allowed, and the refusal comes back with
 * the list of what is missing and a way to jump straight to each one.
 */

export interface MissingField {
  /** Matches the `id={fieldId(key)}` on the field's wrapper, so the summary
   *  can scroll to it. */
  key: string
  label: string
  /** Shown under the list when this is the only thing missing, for fields
   *  where "required" alone isn't enough to act on. */
  hint?: string
}

export function fieldId(key: string): string {
  return `field-${key}`
}

/** Adds the invalid style to a form control, but only once the user has
 *  actually tried to submit — a form is not "wrong" before it is finished. */
export function invalidClass(missing: MissingField[], attempted: boolean, key: string, base = 'form-control'): string {
  return attempted && missing.some(m => m.key === key) ? `${base} field-invalid` : base
}

export function isMissing(missing: MissingField[], attempted: boolean, key: string): boolean {
  return attempted && missing.some(m => m.key === key)
}

export function scrollToField(key: string) {
  const el = document.getElementById(fieldId(key))
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  const focusable = el.querySelector<HTMLElement>('input,select,textarea,button')
  // Delayed so the smooth scroll isn't cut short by the focus jump.
  window.setTimeout(() => focusable?.focus({ preventScroll: true }), 320)
}

interface Props {
  missing: MissingField[]
  /** Set once a submit has been attempted; nothing renders before then. */
  attempted: boolean
  /** Overrides the default "can't submit yet" wording, e.g. for a Next button. */
  action?: string
}

export default function ValidationSummary({ missing, attempted, action = 'submit' }: Props) {
  if (!attempted || missing.length === 0) return null
  const hints = missing.filter(m => m.hint)
  return (
    <div className="validation-summary" role="alert" aria-live="assertive">
      <div className="validation-summary-title">
        Can&apos;t {action} yet — {missing.length} required {missing.length === 1 ? 'field is' : 'fields are'} missing:
      </div>
      <ul className="validation-summary-list">
        {missing.map((m, i) => (
          <li key={`${m.key}-${i}`}>
            <button type="button" className="validation-summary-item" onClick={() => scrollToField(m.key)}>
              {m.label} ↓
            </button>
          </li>
        ))}
      </ul>
      {hints.map((m, i) => (
        <div key={`${m.key}-${i}`} className="validation-summary-hint">{m.label}: {m.hint}</div>
      ))}
    </div>
  )
}
