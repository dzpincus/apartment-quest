@AGENTS.md

# Apartment Quest

Private NYC apartment-hunt tracker for four people. Product spec: `SPEC.md`.
Manual listing entry only — no scraping, no listing-site APIs, no file uploads.

## Stack

- Next.js 16 (App Router, Turbopack) + TypeScript, `src/` dir, pnpm
- Tailwind v4 + shadcn/ui (Base UI under the hood, not Radix)
- Supabase: Postgres + Auth + Realtime (`@supabase/supabase-js`, `@supabase/ssr`)
- TanStack Query for server state, zod + react-hook-form for forms
- date-fns + `@date-fns/tz` for America/New_York rendering
- vitest for pure-logic tests
- Deployed on Vercel

## Setup

```bash
pnpm i
cp .env.example .env.local   # fill in from the Supabase dashboard
pnpm dev                     # http://localhost:3000
```

Env vars (all client-visible, all `NEXT_PUBLIC_`):

| Var | Notes |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon/public key (new-style `sb_publishable_...` also works) |
| `NEXT_PUBLIC_APP_LOGIN_EMAIL` | Identifier for the one shared auth user. Never rendered. |

Missing env does not break `pnpm build` — Supabase clients only throw when
constructed at runtime.

## Database

SQL lives in `supabase/`, applied by hand (no CLI link, no local stack):

- `supabase/migrations/0001_schema.sql` — tables + indexes
- `supabase/migrations/0002_rls.sql` — RLS on every table, one `authenticated` policy each
- `supabase/migrations/0003_rpc_triggers.sql` — `set_updated_at`, `merge_listings`, `unread_counts`, realtime publication
- `supabase/seed.sql` — the four people (idempotent)

Apply in filename order via the Supabase SQL editor (paste + run) or the Supabase
MCP `apply_migration` tool. New changes go in a new numbered file; never edit an
applied one.

Deviations from `SPEC.md` are commented in the SQL: `people.key` + `people.annual_income`,
`thread_reads.listing_id` NOT NULL with a separate `global_reads` table, and CHECK
constraints on the enum-ish text columns.

## Commands

```bash
pnpm dev     # dev server
pnpm lint    # eslint
pnpm build   # production build
pnpm test    # vitest run
```

Run `pnpm lint && pnpm build && pnpm test` before every commit.

## Deploy

Vercel, `main` branch. Set the three env vars in the Vercel project settings for
Production and Preview.

## Architectural rules

- **All writes go through `src/lib/mutations.ts`.** Every mutation writes its row
  *and* the matching `activity` row with a pre-rendered `summary` string. No
  component calls `supabase.from(...).insert/update/delete` directly. Reads go
  through `src/lib/queries.ts` (key factory + fetchers + `use*` hooks); later
  phases add their verbs to `mutations.ts` and nowhere else.
- **Summaries are verb phrases without the actor's name** ("added 214 Grand St
  #4B"): the feed prints the person with their colour, so the name would double up.
  `updateListing` only logs when a meaningful column changed — `updated_at`,
  `last_contacted_at` and `next_action*` are excluded, since those belong to
  phase 3's own verbs.
- **Dedupe**: `dedupeKey(address, unit)` in `src/lib/dedupe.ts` mirrors the
  Postgres generated column byte for byte
  (`lower(regexp_replace(address||'|'||unit, '[^a-zA-Z0-9|]', '', 'g'))`). Change
  one and you must change the other. The add form checks it on blur and again on
  submit; post-hoc dupes use the `merge_listings` RPC from the detail page.
- **Qualification math**: `required = rent * income_multiplier` — NYC 40x means
  combined *annual* income >= 40x *monthly* rent. `SPEC.md` writes
  `rent * 12 * income_multiplier`, which applies the 40x twice; the convention it
  cites wins over its own formula. Documented in `qualification()`.
- **`person_id` comes from `usePerson()`** (`src/lib/person.tsx`), never from a prop
  drill or a fresh localStorage read, and is passed explicitly into every
  `mutations.ts` call (`useMutations(person?.id)`).
- **Two gates**: real Supabase auth (guarded server-side in `src/proxy.ts` — Next 16's
  renamed `middleware.ts`) then the person picker. The login email is an internal
  identifier and must never be rendered.
- **Time**: store UTC, render New York. Use `fmtNY` / `todayNY` from `src/lib/time.ts`;
  never `new Date().toLocaleString()` and never compare dates in local time.
- **Mobile-first**: bottom tab bar under `md`, top bar at `md` and up.
- Types in `src/lib/types.ts` are hand-written and must be updated alongside any
  schema migration.
- There is no per-person security boundary. One shared login, everyone sees and
  edits everything. Intentional.
