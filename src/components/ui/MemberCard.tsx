import { forwardRef } from 'react'
import type { PolicyCard } from '../../types'
import type { PolicyMember } from '../../lib/memberNumbers'
import { MOTIONS_LOGO_PNG_BASE64 } from '../../assets/motionsLogo'
import { formatDate } from '../../lib/dateUtils'
import { isDefaultInsurer } from '../../lib/insurerAssignment'

/**
 * The membership card, at real proportions.
 *
 * Laid out at ID-1 (the bank/driving-licence size, 85.6 x 54 mm) so what is
 * on screen is what comes off the printer. Everything is drawn with plain
 * DOM and inline styles rather than an image, because the export path
 * rasterises this very element — so the preview and the exported file can
 * never drift apart.
 *
 * The card carries no personal data beyond the member's name and number.
 * The RFID tag is printed as a human-readable serial only; what the chip
 * transmits is that same fixed number and nothing else, resolved against
 * policy_cards on our side.
 */

/** ID-1 at 96dpi, scaled up 3x so a rasterised export is print-sharp. */
export const CARD_WIDTH_PX = 1012
export const CARD_HEIGHT_PX = 638

interface Props {
  member: PolicyMember
  card?: PolicyCard
  /** 'front' shows identity; 'back' shows the tag, terms and contact. */
  face?: 'front' | 'back'
  /** 1 = full print size. The on-screen preview scales down from that. */
  scale?: number
  companyName?: string
  companyPhone?: string
  companyEmail?: string
}

const STATUS_COPY: Record<PolicyCard['status'], { label: string; color: string }> = {
  active: { label: 'ACTIVE', color: '#10B981' },
  suspended: { label: 'SUSPENDED', color: '#F59E0B' },
  lost: { label: 'REPORTED LOST', color: '#DC2626' },
  replaced: { label: 'REPLACED', color: '#6B7E99' },
}


const MemberCard = forwardRef<HTMLDivElement, Props>(function MemberCard(
  { member, card, face = 'front', scale = 1, companyName, companyPhone, companyEmail },
  ref,
) {
  const status = card ? STATUS_COPY[card.status] : { label: 'NOT ISSUED', color: '#6B7E99' }

  // Enpassent places business with almost every insurer in Zimbabwe, so a
  // card must never assume it is any one of them by default. It names
  // whichever insurer actually underwrites this member's policy
  // (member.insurer, passed down by the caller); only once that is unknown
  // does it fall back to Enpassent itself as the issuing broker. The house
  // logo is drawn only when the resolved name really is Motions -- it must
  // never appear, even implicitly, on cover placed with anyone else.
  const resolvedName = companyName || member.insurer || 'Enpassent Multiple Agent'
  const showHouseLogo = isDefaultInsurer(resolvedName)

  // px() keeps every dimension proportional to `scale`, so one layout
  // serves both the small on-screen preview and the full-size export.
  const px = (n: number) => `${n * scale}px`

  const shell: React.CSSProperties = {
    width: px(CARD_WIDTH_PX),
    height: px(CARD_HEIGHT_PX),
    borderRadius: px(44),
    overflow: 'hidden',
    position: 'relative',
    fontFamily: "'DM Sans', sans-serif",
    color: '#fff',
    background: 'linear-gradient(135deg, #1B2A5C 0%, #21346C 45%, #4169E1 100%)',
    boxShadow: '0 12px 40px rgba(15,28,46,0.28)',
    flexShrink: 0,
  }

  if (face === 'back') {
    return (
      <div ref={ref} style={shell} data-card-face="back">
        {/* Magnetic-stripe band, purely so the back reads as a real card. */}
        <div style={{ position: 'absolute', top: px(64), left: 0, right: 0, height: px(96), background: '#0B1430' }} />

        <div style={{ position: 'absolute', top: px(196), left: px(56), right: px(56) }}>
          <div style={{ fontSize: px(22), letterSpacing: px(2), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
            Card Serial (RFID)
          </div>
          <div style={{ fontSize: px(44), fontWeight: 700, fontFamily: "'DM Mono', monospace", letterSpacing: px(3), marginTop: px(6) }}>
            {card?.rfidTag || 'NOT ENCODED'}
          </div>

          <div style={{ display: 'flex', gap: px(48), marginTop: px(34) }}>
            <div>
              <div style={{ fontSize: px(20), letterSpacing: px(2), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>Issued</div>
              <div style={{ fontSize: px(28), fontWeight: 600, marginTop: px(4) }}>{formatDate(card?.issuedAt)}</div>
            </div>
            <div>
              <div style={{ fontSize: px(20), letterSpacing: px(2), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>Valid Until</div>
              <div style={{ fontSize: px(28), fontWeight: 600, marginTop: px(4) }}>{formatDate(card?.expiresAt)}</div>
            </div>
            <div>
              <div style={{ fontSize: px(20), letterSpacing: px(2), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>Status</div>
              <div style={{ fontSize: px(28), fontWeight: 700, marginTop: px(4), color: status.color }}>{status.label}</div>
            </div>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: px(40), left: px(56), right: px(56), fontSize: px(20), lineHeight: 1.45, color: 'rgba(255,255,255,0.62)' }}>
          This card remains the property of {resolvedName} and must be returned on request. It proves membership only;
          cover is subject to the policy terms and to premiums being up to date.
          {(companyPhone || companyEmail) && (
            <div style={{ marginTop: px(8), color: 'rgba(255,255,255,0.8)' }}>
              Lost or found? {[companyPhone, companyEmail].filter(Boolean).join(' · ')}
            </div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div ref={ref} style={shell} data-card-face="front">
      {/* Soft highlight, drawn rather than an image so the export stays
          self-contained and crisp at any scale. */}
      <div
        style={{
          position: 'absolute', right: px(-120), top: px(-160),
          width: px(560), height: px(560), borderRadius: '50%',
          background: 'radial-gradient(circle, rgba(255,255,255,0.16) 0%, rgba(255,255,255,0) 70%)',
        }}
      />

      <div style={{ position: 'absolute', top: px(44), left: px(56), right: px(56), display: 'flex', alignItems: 'center', gap: px(18) }}>
        {/* The asset is stored bare for jsPDF's addImage; an <img> needs the
            data: prefix put back on. Only drawn for Motions's own cover --
            it must never appear on a card for cover placed elsewhere. */}
        {showHouseLogo && (
          <img src={`data:image/png;base64,${MOTIONS_LOGO_PNG_BASE64}`} alt="" style={{ width: px(76), height: px(76), objectFit: 'contain' }} />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: px(30), fontWeight: 700, letterSpacing: px(0.5) }}>{resolvedName}</div>
          <div style={{ fontSize: px(19), letterSpacing: px(3), textTransform: 'uppercase', color: 'rgba(255,255,255,0.6)' }}>
            Membership Card
          </div>
        </div>
        <div
          style={{
            fontSize: px(19), fontWeight: 700, letterSpacing: px(1.5),
            padding: `${px(7)} ${px(18)}`, borderRadius: px(999),
            background: 'rgba(255,255,255,0.14)', color: status.color, whiteSpace: 'nowrap',
          }}
        >
          {status.label}
        </div>
      </div>

      {/* Chip, in the position a reader expects it. */}
      <div
        style={{
          position: 'absolute', top: px(178), left: px(56),
          width: px(104), height: px(80), borderRadius: px(14),
          background: 'linear-gradient(140deg, #F5D68A 0%, #C9A34E 55%, #8E7028 100%)',
        }}
      />

      <div style={{ position: 'absolute', top: px(288), left: px(56), right: px(56) }}>
        <div style={{ fontSize: px(20), letterSpacing: px(2.5), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
          Member Number
        </div>
        <div style={{ fontSize: px(52), fontWeight: 700, fontFamily: "'DM Mono', monospace", letterSpacing: px(3), marginTop: px(4) }}>
          {member.memberNumber}
        </div>
      </div>

      <div style={{ position: 'absolute', bottom: px(46), left: px(56), right: px(56), display: 'flex', alignItems: 'flex-end', gap: px(24) }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: px(19), letterSpacing: px(2.5), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>
            {member.role === 'holder' ? 'Policyholder' : `Dependant · ${member.relationship || 'Member'}`}
          </div>
          <div style={{ fontSize: px(40), fontWeight: 700, marginTop: px(4), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.name || '—'}
          </div>
          {/* A dependant is meaningless without the person carrying them,
              so the holder is on the face of every dependant card. */}
          {member.role === 'dependant' && (
            <div style={{ fontSize: px(22), marginTop: px(4), color: 'rgba(255,255,255,0.72)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Carried by {member.holderName}
            </div>
          )}
        </div>
        <div style={{ textAlign: 'right' }}>
          <div style={{ fontSize: px(19), letterSpacing: px(2.5), textTransform: 'uppercase', color: 'rgba(255,255,255,0.55)' }}>Plan</div>
          <div style={{ fontSize: px(26), fontWeight: 600, marginTop: px(4), maxWidth: px(400), whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {member.planName}
          </div>
        </div>
      </div>
    </div>
  )
})

export default MemberCard
