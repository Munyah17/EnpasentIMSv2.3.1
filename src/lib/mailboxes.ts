/**
 * The 9 role addresses mail is attributed to.
 * Mail is SENT from the one mailbox that authenticates with the provider
 * (SMTP_DEFAULT_USER, currently info@enpassent.co.zw); the address below
 * becomes Reply-To, so replies still reach the right desk without the
 * system forging a sender it cannot authenticate as. Only addresses that
 * actually exist as mailboxes will receive those replies.
 */
export const MAILBOXES = {
  /** Automated, non-interactive mail — policy issued, payment receipt,
   *  renewal/billing reminders, password resets. Never expects a reply. */
  noreply: 'noreply@enpassent.co.zw',
  /** Claim submitted, status changes, claim resolution correspondence. */
  claims: 'claims@enpassent.co.zw',
  /** Internal staff/admin notifications (new staff account, staff password
   *  reset) and anything without a more specific home. */
  admin: 'admin@enpassent.co.zw',
  /** Promotional/marketing mass messaging campaigns. */
  marketing: 'marketing@enpassent.co.zw',
  /** Policy eligibility / underwriting queries and decisions. */
  underwriting: 'underwriting@enpassent.co.zw',
  /** Ticket replies and general support correspondence. */
  customerService: 'customerservice@enpassent.co.zw',
  /** Agent/staff recruitment inquiries. */
  recruitment: 'recruitment@enpassent.co.zw',
  /** New leads, quotes, and sales follow-up. */
  sales: 'sales@enpassent.co.zw',
  /** General inbound inquiries with no clearer home. */
  info: 'info@enpassent.co.zw',
} as const
