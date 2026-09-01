/** House date format: DD-MON-YYYY (e.g. 08-AUG-1999), everywhere. */
const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return `${pad2(d.getDate())}-${MONTHS[d.getMonth()]}-${d.getFullYear()}`
}

export function formatDateTime(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return `${formatDate(d)} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`
}

const WEEKDAYS = ['SUNDAY', 'MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY']
const MONTHS_LONG = ['JANUARY', 'FEBRUARY', 'MARCH', 'APRIL', 'MAY', 'JUNE', 'JULY', 'AUGUST', 'SEPTEMBER', 'OCTOBER', 'NOVEMBER', 'DECEMBER']

export function formatDateLong(value: string | Date | null | undefined): string {
  if (!value) return '—'
  const d = typeof value === 'string' ? new Date(value) : value
  if (Number.isNaN(d.getTime())) return '—'
  return `${WEEKDAYS[d.getDay()]}, ${pad2(d.getDate())} ${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`
}
