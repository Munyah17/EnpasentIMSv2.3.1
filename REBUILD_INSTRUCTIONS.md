# Enpassent IMS — Database Rebuild Instructions

## What this is

`database/rebuild_database.sql` builds the full schema — tables, RLS
policies, functions, triggers — from nothing. It seeds no staff accounts
and no demo business data: a fresh run leaves `public.profiles`,
`public.clients`, `public.policies` and everything else genuinely empty.

## Step-by-step rebuild

### 1. Run the base schema

1. Open the Supabase Dashboard → your project → **SQL Editor** → **New Query**
2. Open `database/rebuild_database.sql`, copy the entire file, paste, **Run**

The script is idempotent — safe to re-run; it resets and rebuilds from
scratch each time.

### 2. Run the feature migrations

`rebuild_database.sql` covers the base schema only. Everything built on top
of it since — insurers, the API developer platform, activity logging, login
lockout, member cards, live chat, agriculture assessments, and more — lives
in separate `database/add_*.sql` / `fix_*.sql` files. Run them in the order
listed in each file's own header comment where one exists; most are
idempotent (`IF NOT EXISTS` / `CREATE OR REPLACE`) and safe to re-run.

Skip `reset_database.sql`, `create_profiles_first.sql`, and
`schema_no_profiles.sql` — deprecated, superseded by `rebuild_database.sql`.
Skip `wipe_seed_data.sql` — a one-time historical cleanup, not applicable to
a fresh database.

### 3. Verify

```sql
SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';
SELECT COUNT(*) FROM public.profiles;   -- 0 on a fresh build
SELECT COUNT(*) FROM auth.users;        -- 0 on a fresh build
```

### 4. Create the bootstrap Super Admin

No account is seeded by any script — see `rebuild_database.sql`'s "9a.
Create the bootstrap Super Admin" comment for the exact `curl` command
against Supabase's Auth Admin API, and the `permissions = ARRAY['all']`
follow-up it needs. That account then creates every other staff account
from the app's own Staff page, with a real password each — never a shared
one committed to this repo.

### 5. Run the app

```bash
npm install
npm run dev
```

Needs `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` in `.env` (client-safe),
and, for server-side functions under `api/`, `SUPABASE_SERVICE_ROLE_KEY`
(never `VITE_`-prefixed — Vite inlines any `VITE_*` var into the browser
bundle).

## Troubleshooting

### "permission denied for schema public"

New-project issue. Run first:

```sql
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO service_role;
```

### Auth users don't appear in profiles

`handle_new_user()` (a trigger on `auth.users`) auto-creates the matching
profile row. If profiles are missing, the trigger isn't attached — re-run
the trigger section of `rebuild_database.sql`.

### RLS blocking everything

The app authenticates with the **anon key**, which is RLS-bound throughout.
Confirm `.env` has the right `VITE_SUPABASE_ANON_KEY`, and that you're
signing in through Supabase Auth (`signInWithPassword`), not inspecting
data with a service-role connection and expecting the same rows back.

### Adding a staff account outside the app

Prefer the app's own Staff page. If you must do it directly, use the Auth
Admin API (see step 4) rather than inserting into `auth.users` by hand —
that table's internal shape isn't a stable contract to write to.

## Files

- `database/rebuild_database.sql` — canonical full rebuild (base schema only)
- `database/supabase_schema.sql` — reference copy, kept to match
- `database/add_*.sql`, `fix_*.sql` — feature migrations layered on top
- `database/reset_database.sql`, `create_profiles_first.sql`,
  `schema_no_profiles.sql` — deprecated, do not run
