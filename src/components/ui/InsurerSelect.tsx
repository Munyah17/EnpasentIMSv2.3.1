import type { InsurerRecord } from '../../types'

interface Props {
  value: string
  onChange: (value: string) => void
  options: InsurerRecord[]
  /** Shown when nothing is picked. */
  placeholder?: string
  id?: string
}

/** Insurer picker. Flat list, in the order db.insurers.list() returns. */
export default function InsurerSelect({ value, onChange, options, placeholder = 'Select insurer…', id }: Props) {
  return (
    <select
      id={id}
      className="form-control"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {options.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
    </select>
  )
}
