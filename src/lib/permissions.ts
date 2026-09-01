/**
 * Canonical permission catalog. Each key is checked via useAuth().hasPermission(key).
 * Grouped by domain purely for the UI (Roles & permission checkboxes).
 *
 * Design: super_admin always carries the 'all' sentinel and bypasses every
 * check, including the two actions that are intentionally NOT in this
 * catalog at all — deleting a staff member and deleting a client. Those stay
 * hard-gated to role === 'super_admin' directly in the pages that expose
 * them (Staff.tsx, Clients.tsx) and via Postgres RLS, not through this
 * permission list, so no custom role or per-user override can ever grant
 * them. Every other permission here is an app-layer gate on top of the
 * existing coarse RLS staff tier (is_staff()) — it controls what a staff
 * member sees/can click, not a separate per-action database policy.
 */
export interface PermissionDef {
  key: string
  label: string
}

export interface PermissionGroup {
  group: string
  items: PermissionDef[]
}

export const PERMISSION_CATALOG: PermissionGroup[] = [
  {
    group: 'Policies',
    items: [
      { key: 'policies.view', label: 'View Policies' },
      { key: 'policies.create', label: 'Create Policies' },
      { key: 'policies.edit', label: 'Edit Policy Details' },
      { key: 'policies.approve', label: 'Approve Policies' },
      { key: 'policies.reject', label: 'Reject Policies' },
      { key: 'policies.delete', label: 'Delete Policies' },
    ],
  },
  {
    group: 'Claims',
    items: [
      { key: 'claims.view', label: 'View Claims' },
      { key: 'claims.create', label: 'Submit Claims' },
      { key: 'claims.edit', label: 'Edit / Review Claims' },
      { key: 'claims.intake', label: 'Accept/Reject Claim Intake (Claims Receiver)' },
      { key: 'claims.assess', label: 'Assess & Escalate Claims (Claims Processor)' },
      { key: 'claims.approve', label: 'Final Approve Claims (MD/COO)' },
      { key: 'claims.reject', label: 'Final Decline Claims (MD/COO)' },
      { key: 'claims.physical_assessment', label: 'Conduct Physical Assessments (Assessor)' },
      { key: 'claims.delete', label: 'Delete Claims (permanent, logged)' },
    ],
  },
  {
    group: 'Clients',
    items: [
      { key: 'clients.view', label: 'View Clients' },
      { key: 'clients.create', label: 'Register Clients' },
      { key: 'clients.edit', label: 'Edit Clients' },
    ],
  },
  {
    group: 'Membership IDs',
    items: [
      { key: 'cards.view', label: 'View Membership Cards' },
      { key: 'cards.issue', label: 'Issue Cards & Assign RFID Tags' },
    ],
  },
  {
    group: 'Products',
    items: [
      { key: 'products.view', label: 'View Products' },
      { key: 'products.create', label: 'Create Products' },
      { key: 'products.edit', label: 'Modify Products' },
    ],
  },
  {
    group: 'Payments',
    items: [
      { key: 'payments.view', label: 'View Payments' },
      { key: 'payments.capture', label: 'Capture Payments' },
      { key: 'payments.validate', label: 'Validate Payments' },
    ],
  },
  {
    group: 'Staff',
    items: [
      { key: 'staff.view', label: 'View Staff' },
      { key: 'staff.create', label: 'Create Staff Accounts' },
      { key: 'staff.edit', label: 'Edit Staff Accounts' },
      { key: 'staff.reset_password', label: 'Reset Staff Passwords' },
    ],
  },
  {
    group: 'Communications',
    items: [
      { key: 'communications.send_sms', label: 'Send Bulk SMS' },
      { key: 'communications.send_email', label: 'Send Email' },
    ],
  },
  {
    group: 'Reports',
    items: [
      { key: 'reports.view', label: 'Access Reports' },
    ],
  },
]

export const ALL_PERMISSION_KEYS: string[] = PERMISSION_CATALOG.flatMap(g => g.items.map(i => i.key))

/** The Admin role's default rights per the 2026-08 access review — everything
 *  short of the two hard-gated destructive actions (staff/client delete). */
export const ADMIN_DEFAULT_PERMISSIONS: string[] = ALL_PERMISSION_KEYS
