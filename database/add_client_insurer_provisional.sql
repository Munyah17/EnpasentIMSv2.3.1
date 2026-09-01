-- Records that a client's insurer was defaulted rather than chosen.
--
-- Enpassent is a broker, so the insurer is a genuine choice and the field is
-- optional at signup -- a registration must never be blocked because the
-- question has not been answered. When it is left blank the client is
-- provisionally placed with the house insurer (Motions) so the record has
-- somewhere to sit, and this column remembers that nobody actually picked.
--
-- Staff use it as a work queue: these are the clients still to be asked.
-- It is deliberately NOT a policy column. Registering a client puts no cover
-- in place, but the insurer on a policy is the party that pays the claim, so
-- that one is only ever set by an explicit choice. See
-- src/lib/insurerAssignment.ts for the rules this column exists to support.

ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS insurer_provisional BOOLEAN NOT NULL DEFAULT FALSE;

-- Existing rows: anyone already carrying an insurer had it entered by a
-- person, so none of them are provisional. The DEFAULT FALSE above already
-- says so; this is only here to be explicit about the backfill decision.

-- Staff filter this constantly ("who still needs asking?"), and it is a
-- small minority of rows, so a partial index is the cheap shape.
CREATE INDEX IF NOT EXISTS clients_insurer_provisional_idx
  ON public.clients (insurer_provisional)
  WHERE insurer_provisional;
