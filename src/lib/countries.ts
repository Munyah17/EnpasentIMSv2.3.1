export interface Country {
  name: string
  code: string // ISO 3166-1 alpha-2
  dial: string // e.g. "+263"
  flag: string
}

// Africa first (primary market), then the rest of the world alphabetically.
export const COUNTRIES: Country[] = [
  { name: 'Zimbabwe', code: 'ZW', dial: '+263', flag: '🇿🇼' },
  { name: 'South Africa', code: 'ZA', dial: '+27', flag: '🇿🇦' },
  { name: 'Botswana', code: 'BW', dial: '+267', flag: '🇧🇼' },
  { name: 'Zambia', code: 'ZM', dial: '+260', flag: '🇿🇲' },
  { name: 'Mozambique', code: 'MZ', dial: '+258', flag: '🇲🇿' },
  { name: 'Malawi', code: 'MW', dial: '+265', flag: '🇲🇼' },
  { name: 'Namibia', code: 'NA', dial: '+264', flag: '🇳🇦' },
  { name: 'Tanzania', code: 'TZ', dial: '+255', flag: '🇹🇿' },
  { name: 'Kenya', code: 'KE', dial: '+254', flag: '🇰🇪' },
  { name: 'Uganda', code: 'UG', dial: '+256', flag: '🇺🇬' },
  { name: 'Nigeria', code: 'NG', dial: '+234', flag: '🇳🇬' },
  { name: 'Ghana', code: 'GH', dial: '+233', flag: '🇬🇭' },
  { name: 'Egypt', code: 'EG', dial: '+20', flag: '🇪🇬' },
  { name: 'Ethiopia', code: 'ET', dial: '+251', flag: '🇪🇹' },
  { name: 'Rwanda', code: 'RW', dial: '+250', flag: '🇷🇼' },
  { name: 'Lesotho', code: 'LS', dial: '+266', flag: '🇱🇸' },
  { name: 'Eswatini', code: 'SZ', dial: '+268', flag: '🇸🇿' },
  { name: 'Angola', code: 'AO', dial: '+244', flag: '🇦🇴' },
  { name: 'DR Congo', code: 'CD', dial: '+243', flag: '🇨🇩' },
  { name: 'Algeria', code: 'DZ', dial: '+213', flag: '🇩🇿' },
  { name: 'Morocco', code: 'MA', dial: '+212', flag: '🇲🇦' },
  { name: 'Senegal', code: 'SN', dial: '+221', flag: '🇸🇳' },
  { name: 'Cameroon', code: 'CM', dial: '+237', flag: '🇨🇲' },
  { name: "Côte d'Ivoire", code: 'CI', dial: '+225', flag: '🇨🇮' },
  { name: 'Sudan', code: 'SD', dial: '+249', flag: '🇸🇩' },
  { name: 'Somalia', code: 'SO', dial: '+252', flag: '🇸🇴' },
  { name: 'Tunisia', code: 'TN', dial: '+216', flag: '🇹🇳' },

  { name: 'United Kingdom', code: 'GB', dial: '+44', flag: '🇬🇧' },
  { name: 'United States', code: 'US', dial: '+1', flag: '🇺🇸' },
  { name: 'Canada', code: 'CA', dial: '+1', flag: '🇨🇦' },
  { name: 'Australia', code: 'AU', dial: '+61', flag: '🇦🇺' },
  { name: 'New Zealand', code: 'NZ', dial: '+64', flag: '🇳🇿' },
  { name: 'Ireland', code: 'IE', dial: '+353', flag: '🇮🇪' },
  { name: 'Germany', code: 'DE', dial: '+49', flag: '🇩🇪' },
  { name: 'France', code: 'FR', dial: '+33', flag: '🇫🇷' },
  { name: 'Spain', code: 'ES', dial: '+34', flag: '🇪🇸' },
  { name: 'Portugal', code: 'PT', dial: '+351', flag: '🇵🇹' },
  { name: 'Italy', code: 'IT', dial: '+39', flag: '🇮🇹' },
  { name: 'Netherlands', code: 'NL', dial: '+31', flag: '🇳🇱' },
  { name: 'Belgium', code: 'BE', dial: '+32', flag: '🇧🇪' },
  { name: 'Switzerland', code: 'CH', dial: '+41', flag: '🇨🇭' },
  { name: 'Sweden', code: 'SE', dial: '+46', flag: '🇸🇪' },
  { name: 'Norway', code: 'NO', dial: '+47', flag: '🇳🇴' },
  { name: 'Denmark', code: 'DK', dial: '+45', flag: '🇩🇰' },
  { name: 'Poland', code: 'PL', dial: '+48', flag: '🇵🇱' },
  { name: 'United Arab Emirates', code: 'AE', dial: '+971', flag: '🇦🇪' },
  { name: 'Saudi Arabia', code: 'SA', dial: '+966', flag: '🇸🇦' },
  { name: 'India', code: 'IN', dial: '+91', flag: '🇮🇳' },
  { name: 'Pakistan', code: 'PK', dial: '+92', flag: '🇵🇰' },
  { name: 'China', code: 'CN', dial: '+86', flag: '🇨🇳' },
  { name: 'Japan', code: 'JP', dial: '+81', flag: '🇯🇵' },
  { name: 'South Korea', code: 'KR', dial: '+82', flag: '🇰🇷' },
  { name: 'Singapore', code: 'SG', dial: '+65', flag: '🇸🇬' },
  { name: 'Malaysia', code: 'MY', dial: '+60', flag: '🇲🇾' },
  { name: 'Philippines', code: 'PH', dial: '+63', flag: '🇵🇭' },
  { name: 'Brazil', code: 'BR', dial: '+55', flag: '🇧🇷' },
  { name: 'Mexico', code: 'MX', dial: '+52', flag: '🇲🇽' },
]

export const DEFAULT_COUNTRY = COUNTRIES[0] // Zimbabwe

/** Best-effort split of a stored phone string like "+263 77 123 4567" into
 *  its country and local-number parts, for editing an existing record. */
export function splitPhone(value: string | undefined): { country: Country; local: string } {
  if (!value) return { country: DEFAULT_COUNTRY, local: '' }
  const trimmed = value.trim()
  const match = [...COUNTRIES].sort((a, b) => b.dial.length - a.dial.length).find(c => trimmed.startsWith(c.dial))
  if (match) return { country: match, local: trimmed.slice(match.dial.length).trim() }
  return { country: DEFAULT_COUNTRY, local: trimmed }
}
