import { useState, useRef, useEffect } from 'react'
import { COUNTRIES, splitPhone, type Country } from '../../lib/countries'

interface Props {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  disabled?: boolean
}

/** Highlights the first occurrence of `query` within `text`, case-insensitive. */
function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>
  const i = text.toLowerCase().indexOf(query.toLowerCase())
  if (i === -1) return <>{text}</>
  return (
    <>
      {text.slice(0, i)}
      <mark className="phone-input-match">{text.slice(i, i + query.length)}</mark>
      {text.slice(i + query.length)}
    </>
  )
}

export default function PhoneInput({ value, onChange, placeholder, disabled }: Props) {
  const parsed = splitPhone(value)
  const [country, setCountry] = useState<Country>(parsed.country)
  const [local, setLocal] = useState(parsed.local)
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  // Re-sync from parent if the value was reset externally (e.g. form cleared)
  useEffect(() => {
    if (value === '') { setCountry(COUNTRIES[0]); setLocal('') }
  }, [value])

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onClickOutside)
    return () => document.removeEventListener('mousedown', onClickOutside)
  }, [])

  const commit = (nextCountry: Country, nextLocal: string) => {
    onChange(nextLocal ? `${nextCountry.dial} ${nextLocal}`.trim() : '')
  }

  const selectCountry = (c: Country) => {
    setCountry(c)
    setOpen(false)
    setSearch('')
    setActiveIndex(0)
    commit(c, local)
  }

  // Ranked, "suggestive" matching rather than a flat contains-filter: exact
  // name/code starts-with ranks above a dial-code starts-with, which ranks
  // above a plain substring match anywhere — so typing "zi" surfaces
  // Zimbabwe before something that merely contains "zi" mid-name, and
  // typing "26" surfaces the +26x dial codes first.
  const q = search.trim().toLowerCase()
  const filtered = q === '' ? COUNTRIES : COUNTRIES
    .map(c => {
      const name = c.name.toLowerCase()
      const dial = c.dial.toLowerCase()
      const code = c.code.toLowerCase()
      let rank = -1
      if (name.startsWith(q) || code === q) rank = 0
      else if (dial.startsWith(q) || dial.startsWith(`+${q}`)) rank = 1
      else if (name.includes(q)) rank = 2
      else if (dial.includes(q)) rank = 3
      return { c, rank }
    })
    .filter(r => r.rank !== -1)
    .sort((a, b) => a.rank - b.rank || a.c.name.localeCompare(b.c.name))
    .map(r => r.c)

  useEffect(() => { setActiveIndex(0) }, [search])

  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const active = list.querySelector('[data-active="true"]')
    active?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex])

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIndex(i => Math.min(i + 1, filtered.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (filtered[activeIndex]) selectCountry(filtered[activeIndex])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  return (
    <div className={`phone-input${disabled ? ' disabled' : ''}`} ref={rootRef}>
      <button type="button" className="phone-input-country" disabled={disabled} onClick={() => !disabled && setOpen(o => !o)}>
        <span>{country.flag}</span>
        <span className="phone-input-dial">{country.dial}</span>
        <span className="phone-input-caret">▾</span>
      </button>
      <input
        className="form-control phone-input-number"
        type="tel"
        value={local}
        placeholder={placeholder ?? '77 123 4567'}
        disabled={disabled}
        onChange={e => { setLocal(e.target.value); commit(country, e.target.value) }}
      />
      {open && !disabled && (
        <div className="phone-input-dropdown">
          <input
            className="form-control phone-input-search"
            placeholder="Search country or code…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoFocus
          />
          <div className="phone-input-list" ref={listRef}>
            {filtered.length === 0 ? (
              <div className="phone-input-empty">No matches.</div>
            ) : filtered.map((c, i) => (
              <button
                type="button"
                key={c.code}
                data-active={i === activeIndex}
                className={`phone-input-option${c.code === country.code ? ' active' : ''}${i === activeIndex ? ' highlighted' : ''}`}
                onClick={() => selectCountry(c)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                <span>{c.flag}</span>
                <span className="phone-input-option-name"><Highlight text={c.name} query={search} /></span>
                <span className="phone-input-option-dial"><Highlight text={c.dial} query={search} /></span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
