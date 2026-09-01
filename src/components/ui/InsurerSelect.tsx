import type { InsurerRecord } from '../../types'
import { findHouseInsurer, isHouseInsurer } from '../../lib/insurerAssignment'

interface Props {
  value: string
  onChange: (value: string) => void
  options: InsurerRecord[]
  /** Shown when nothing is picked. */
  placeholder?: string
  id?: string
}

/**
 * The insurer picker, shared by the flows that acquire business.
 *
 * Enpassent places with almost every insurer in Zimbabwe, so this is a real
 * choice and the field is optional everywhere it appears. Motions leads the
 * list and sits in its own group so it reads as the house option rather than
 * as one more name in an alphabet -- db.insurers.list() already returns it
 * first, and the grouping makes that visible instead of merely true.
 */
export default function InsurerSelect({ value, onChange, options, placeholder = 'Select insurer…', id }: Props) {
  const house = findHouseInsurer(options)
  const others = options.filter(i => !isHouseInsurer(i.name))

  return (
    <select
      id={id}
      className="form-control"
      value={value}
      onChange={e => onChange(e.target.value)}
    >
      <option value="">{placeholder}</option>
      {house && (
        <optgroup label="">
          <option value={house.name} style={{ fontWeight: 700 }}>{house.name}</option>
        </optgroup>
      )}
      {others.length > 0 && (
        <optgroup label={house ? '' : 'Insurers'}>
          {others.map(i => <option key={i.id} value={i.name}>{i.name}</option>)}
        </optgroup>
      )}
    </select>
  )
}
