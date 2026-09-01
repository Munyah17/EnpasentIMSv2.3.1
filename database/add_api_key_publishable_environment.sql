-- Developer API keys move from a single secret key to a publishable +
-- secret pair (mirrors Stripe's pk_/sk_ pattern), plus a sandbox/live
-- environment tag. publishable_key is safe to store and display in plain
-- text — it identifies the key but grants nothing on its own; only
-- key_hash (the secret) is checked for real API access.
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS publishable_key TEXT;
ALTER TABLE public.api_keys ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'live' CHECK (environment IN ('sandbox','live'));
