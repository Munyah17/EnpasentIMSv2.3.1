-- One-time production data wipe, run 2026-08-06, ahead of real launch.
-- Business starts from zero; only Staff (profiles.role != 'policyholder')
-- and NetOne/MNO integration (client-side simulation, no DB table) are kept.
BEGIN;

TRUNCATE
  public.fraud_cases,
  public.claims,
  public.payments,
  public.tickets,
  public.emails,
  public.reminders,
  public.caution_flags,
  public.login_attempts,
  public.leads,
  public.policies,
  public.clients,
  public.products
RESTART IDENTITY CASCADE;

COMMIT;
