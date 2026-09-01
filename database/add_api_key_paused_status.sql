-- Adds 'paused' as a valid api_keys.status alongside 'active'/'revoked'.
-- Paused is reversible (a developer's key can be resumed); revoked is not.
-- The external API (api/v1/[...path].ts) already only accepts
-- status = 'active', so a paused key is rejected the same way a revoked
-- one is — no handler changes needed, this is purely a schema unlock for
-- the admin UI's new Pause/Resume actions.

ALTER TABLE public.api_keys DROP CONSTRAINT IF EXISTS api_keys_status_check;
ALTER TABLE public.api_keys ADD CONSTRAINT api_keys_status_check CHECK (status IN ('active','paused','revoked'));
