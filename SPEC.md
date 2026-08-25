# Apartment Hunt Tracker — Build Spec

A private web app for 4 friends searching for apartments in NYC together. Shared dumping
ground for listings, a place to coordinate broker follow-up, and a chat space kept separate
from our day-to-day group chat.

Apartment search is **manual**. No scraping, no listing-site APIs, no autofill. People paste
in what they find.

## Stack

- Next.js (App Router, TypeScript)
- Supabase (Postgres, Auth, Realtime)
- Tailwind
- Deployed on Vercel

## Access model

Two gates, in order.

**1. Password (real auth, not a client-side check)**

A single shared Supabase auth user. The login screen is **password only**: one label, one
password input, one button. No email field, no signup link, no forgot-password flow.

Supabase requires an identifier alongside the password, so the account's email is held in
`NEXT_PUBLIC_APP_LOGIN_EMAIL` and passed to `signInWithPassword` under the hood. It is an
internal identifier and must never be rendered. Session persists, so logging in is a
once-per-device step.

Setup:

- Create the user from the Supabase dashboard with auto-confirm on, so no confirmation
  email is ever sent.
- Turn off email confirmations and signups in Auth settings. Nobody should be able to
  create a second account.
- Use an address on a domain you control. Fake TLDs like `.local` are sometimes rejected
  by address validation.

Why not a passphrase checked in localStorage: the Supabase anon key is visible in the client
bundle, so a client-side gate protects nothing. A real session means RLS can require
`auth.role() = 'authenticated'` and Postgres enforces it regardless of what the client does.

**2. Name**

After auth, if no `person_id` in localStorage, show a blocking modal: a label, a text input,
a submit button. On submit, match case-insensitively against `people.name` or insert a new
row, then store `person_id` in localStorage. No action anywhere in the app is possible
until this is set. Every mutation carries the `person_id`.

There is no per-person security boundary. All four people share one login and can see and
edit everything. That is intentional.

## Schema

```sql
create extension if not exists pgcrypto;

create table people (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  color text default '#888',
  created_at timestamptz default now()
);
create unique index people_name_lower on people (lower(name));

create table brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

create table listings (
  id uuid primary key default gen_random_uuid(),
  address text not null,
  unit text,
  neighborhood text,
  rent int,
  beds numeric,
  baths numeric,
  sqft int,
  url text,
  available_date date,
  fee_type text default 'unknown',        -- no_fee | fee | op | unknown
  broker_fee_pct numeric,
  guarantor_ok boolean,
  income_multiplier numeric default 40,   -- NYC standard is 40x monthly rent
  trains text,
  notes text,
  broker_id uuid references brokers(id),
  added_by uuid references people(id),
  status text default 'saved',            -- saved | contacted | tour_scheduled | toured | applied | passed | lost
  -- follow-up engine
  last_contacted_at timestamptz,
  next_action text,
  next_action_due date,
  next_action_owner uuid references people(id),
  -- dedup
  dedupe_key text generated always as (
    lower(regexp_replace(coalesce(address,'') || '|' || coalesce(unit,''), '[^a-zA-Z0-9|]', '', 'g'))
  ) stored,
  merged_into uuid references listings(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index listings_dedupe on listings (dedupe_key);
create index listings_next_due on listings (next_action_due) where merged_into is null;
create index listings_status on listings (status) where merged_into is null;

create table interactions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  person_id uuid references people(id),
  kind text,                              -- call | email | text | tour | note
  notes text,
  occurred_at timestamptz default now()
);
create index interactions_listing on interactions (listing_id, occurred_at desc);

create table votes (
  listing_id uuid references listings(id) on delete cascade,
  person_id uuid references people(id),
  vote text,                              -- yes | no | maybe
  comment text,
  updated_at timestamptz default now(),
  primary key (listing_id, person_id)
);

-- listing_id null means the global thread
create table messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  person_id uuid references people(id) not null,
  body text not null,
  created_at timestamptz default now()
);
create index messages_thread on messages (listing_id, created_at desc);

create table thread_reads (
  person_id uuid references people(id),
  listing_id uuid references listings(id) on delete cascade,
  last_read_at timestamptz default now(),
  primary key (person_id, listing_id)
);
-- global thread reads are stored with a sentinel row per person where listing_id is null;
-- if the null-in-PK constraint is awkward, use a separate global_reads(person_id, last_read_at) table

create table activity (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) not null,
  verb text not null,                     -- added_listing | edited_listing | changed_status | voted |
                                          -- messaged | logged_interaction | added_broker |
                                          -- set_next_action | updated_document | merged_listing
  entity_type text,                       -- listing | broker | message | document
  entity_id uuid,
  summary text not null,                  -- pre-rendered, e.g. "moved 214 Grand St to Tour scheduled"
  created_at timestamptz default now()
);
create index activity_recent on activity (created_at desc);

-- Phase 5, links only, never files
create table documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id),
  doc_type text not null,                 -- pay_stubs | bank_statements | tax_return |
                                          -- employment_letter | id | credit_report | guarantor_packet
  drive_url text,
  status text default 'missing',          -- missing | ready | expired
  updated_at timestamptz default now(),
  unique (person_id, doc_type)
);

create table doc_shares (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  shared_with text,                       -- broker email
  shared_by uuid references people(id),
  shared_at timestamptz default now(),
  revoked_at timestamptz
);
```

**RLS**: enable on every table. One policy per table:
`using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated')`.

## Activity tracking

Log impressions, not observations. Anything that leaves a mark gets a row; nothing that is
merely looking does. No view counts, no presence, no "last seen."

Write an `activity` row on: listing added, listing edited (only when a meaningful field
changes, not on every keystroke), status changed, vote cast or changed, message posted,
interaction logged, broker added, next action set or cleared, document status changed,
listings merged.

Write the `summary` string at insert time rather than reconstructing it on read. It keeps
the feed a single cheap query and means historical entries stay readable after the
underlying listing changes.

## Screens

**Home — Follow-up queue**

The default landing screen. Not a listing gallery. Three buckets:

- **Overdue**: `next_action_due < today`
- **Today**: `next_action_due = today`
- **Cold**: `status = 'contacted'` and `last_contacted_at < now() - interval '24 hours'`
  and `next_action` is null

24 hours, not 4 days. NYC listings turn over inside 48 and brokers stop replying to people
who go quiet.

Each row: address, broker name, what the next action is, who owns it, one-tap "Log contact."
Logging inserts an `interaction`, bumps `last_contacted_at`, and immediately prompts for the
next action and due date. That prompt is what keeps the whole system alive. If it is
skippable, everything rots.

Below the buckets, the activity feed. Reverse chronological, last ~50, grouped by person
with their color.

**Listings — table**

Dense, sortable, filterable on price, beds, neighborhood, status, and fee type. Inline edit.
Add via a modal. Rows where `merged_into` is not null are hidden.

Show combined qualification inline: sum of the four people's stated annual incomes against
`rent * 12 * income_multiplier`, with a pass/fail marker. Roommate qualification math is the
thing people most often get wrong. A single `annual_income` int on `people` covers it.

On add, check `dedupe_key` against existing rows. On a hit, show "This looks like a listing
Sam already added" with a link and a Merge action rather than blocking the insert.

**Listing detail**

Full fields, broker card, votes from all four people, interaction history, and the listing's
message thread.

**Chat**

Global thread as its own screen. Per-listing threads live on the listing detail page. Realtime
via Supabase subscription on `messages`. Unread badges from `thread_reads`.

## Build order

1. Supabase project, schema, RLS, shared auth user. Next.js scaffold, password screen, name
   modal, `person_id` in localStorage.
2. Listings CRUD, table view with filters, broker records, dedup check on add.
3. Follow-up queue, interaction logging with the forced next-action prompt, activity feed.
4. Messaging: global thread, per-listing threads, realtime, unread badges.
5. Votes and comments.
6. Documents and share log, if still wanted by then.

## Explicitly out of scope

- Per-user accounts or permissions
- External chat integration
- Listing-site scraping or URL autofill
- File uploads of any kind (documents are Drive links only)
- Map and commute times

## Notes for the implementer

- Ship phases 1 through 3 before touching anything else. The app is useful at the end of
  phase 3 and everything after is enhancement.
- Do not build a settings page. Four people, one search, a few weeks.
- Seed the four `people` rows manually rather than building admin UI.
- Timestamps in UTC, rendered in America/New_York.
