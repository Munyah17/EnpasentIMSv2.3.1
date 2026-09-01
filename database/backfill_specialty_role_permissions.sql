-- The four non-admin staff roles were seeded with legacy panel-name tags
-- (e.g. permissions = '{claims,tickets,fraud,email,profile}') from before the
-- granular dotted-key permission catalog (src/lib/permissions.ts) existed.
-- Those tags don't match any key in the new catalog, so the new
-- hasPermission()-gated buttons (Approve/Reject claim, Record Payment, Add
-- Product, etc.) would silently disappear for these accounts without this
-- backfill — they already had equivalent access via the old panel tags, this
-- just re-expresses it in the new key format. admin/super_admin are
-- untouched (already 'all_except_super' / 'all', which bypass every check).
UPDATE public.profiles SET permissions = ARRAY[
  'claims.view','claims.create','claims.edit','claims.approve','claims.reject',
  'communications.send_email'
] WHERE role = 'claims_officer';

UPDATE public.profiles SET permissions = ARRAY[
  'payments.view','payments.capture','payments.validate','reports.view',
  'communications.send_email'
] WHERE role = 'finance';

UPDATE public.profiles SET permissions = ARRAY[
  'policies.view','policies.create','policies.edit',
  'products.view','products.create','products.edit',
  'clients.view','clients.create','clients.edit',
  'communications.send_email'
] WHERE role = 'policy_admin';

UPDATE public.profiles SET permissions = ARRAY[
  'clients.view','clients.create','clients.edit',
  'communications.send_email','communications.send_sms'
] WHERE role = 'client_relations';
