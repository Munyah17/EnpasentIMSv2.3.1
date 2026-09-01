-- Replace the insurer list with the registered entity names.
--
-- The list held trading names (CBZ Life, Doves, EcoSure, Nyaradzo Funeral,
-- ZB Life). These are the registered names as they appear in IPEC's
-- quarterly returns: Table 5-3 (short-term insurers) and Table 7-3
-- (microinsurers), as at 31 March 2026.
--
-- Motions stays as plain "Motions" rather than its registered
-- "Motions Microinsurance", and leads the list everywhere -- see
-- houseInsurerFirst() in src/lib/db.ts, which pins it to the top and
-- leaves everything else A-Z.

-- Old trading names, dropped only where no policy actually points at them.
-- policies.insurer holds the name as text rather than a foreign key, so
-- removing one that is in use would orphan those policies.
DELETE FROM public.insurers
 WHERE name IN ('CBZ Life', 'Doves', 'EcoSure', 'Nyaradzo Funeral', 'ZB Life')
   AND name NOT IN (SELECT DISTINCT insurer FROM public.policies WHERE insurer IS NOT NULL);

-- Short-term insurers (IPEC Table 5-3).
INSERT INTO public.insurers (name, status) VALUES
  ('AFC', 'active'),
  ('Alliance', 'active'),
  ('Allied', 'active'),
  ('CBZ', 'active'),
  ('CELL', 'active'),
  ('Champions', 'active'),
  ('Clarion', 'active'),
  ('Credsure', 'active'),
  ('ECGC', 'active'),
  ('Econet', 'active'),
  ('Empaya', 'active'),
  ('Evolution', 'active'),
  ('FBC', 'active'),
  ('Hamilton', 'active'),
  ('Misty', 'active'),
  ('Nicoz Diamond', 'active'),
  ('Old Mutual', 'active'),
  ('Quality', 'active'),
  ('Safel', 'active'),
  ('Sanctuary', 'active'),
  ('Zimnat Lion', 'active')
ON CONFLICT (name) DO NOTHING;

-- Microinsurers (IPEC Table 7-3). Motions is deliberately absent: it is
-- already on file as "Motions" and must stay that way.
INSERT INTO public.insurers (name, status) VALUES
  ('Bayce Microinsurance', 'active'),
  ('Clientsure Microinsurance', 'active'),
  ('Coverlink Microinsurance', 'active'),
  ('Ethical Microinsurance', 'active'),
  ('Golden Knot Microinsurance', 'active'),
  ('Highground Microinsurance', 'active'),
  ('Microsure Microinsurance', 'active'),
  ('Mountsentry Microinsurance', 'active')
ON CONFLICT (name) DO NOTHING;
