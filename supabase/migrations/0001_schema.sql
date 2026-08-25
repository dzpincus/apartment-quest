-- Apartment Quest — schema
-- Apply in the Supabase SQL editor (or via MCP) in filename order.

create extension if not exists pgcrypto;

-- people ---------------------------------------------------------------------
-- Deviation from SPEC: `key` (stable seeded identity) and `annual_income`
-- (roommate qualification math) added.
create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  name text not null,
  color text default '#888',
  annual_income int default 0,
  created_at timestamptz default now()
);
create unique index if not exists people_name_lower on people (lower(name));

-- brokers --------------------------------------------------------------------
create table if not exists brokers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  company text,
  phone text,
  email text,
  notes text,
  created_at timestamptz default now()
);

-- listings -------------------------------------------------------------------
create table if not exists listings (
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
  fee_type text default 'unknown' check (fee_type in ('no_fee', 'fee', 'op', 'unknown')),
  broker_fee_pct numeric,
  guarantor_ok boolean,
  income_multiplier numeric default 40,   -- NYC standard is 40x monthly rent
  trains text,
  notes text,
  broker_id uuid references brokers(id),
  added_by uuid references people(id),
  status text default 'saved' check (
    status in ('saved', 'contacted', 'tour_scheduled', 'toured', 'applied', 'passed', 'lost')
  ),
  -- follow-up engine
  last_contacted_at timestamptz,
  next_action text,
  next_action_due date,
  next_action_owner uuid references people(id),
  -- dedup
  dedupe_key text generated always as (
    lower(regexp_replace(coalesce(address, '') || '|' || coalesce(unit, ''), '[^a-zA-Z0-9|]', '', 'g'))
  ) stored,
  merged_into uuid references listings(id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists listings_dedupe on listings (dedupe_key);
create index if not exists listings_next_due on listings (next_action_due) where merged_into is null;
create index if not exists listings_status on listings (status) where merged_into is null;

-- interactions ---------------------------------------------------------------
create table if not exists interactions (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  person_id uuid references people(id),
  kind text check (kind in ('call', 'email', 'text', 'tour', 'note')),
  notes text,
  occurred_at timestamptz default now()
);
create index if not exists interactions_listing on interactions (listing_id, occurred_at desc);

-- votes ----------------------------------------------------------------------
create table if not exists votes (
  listing_id uuid references listings(id) on delete cascade,
  person_id uuid references people(id),
  vote text check (vote in ('yes', 'no', 'maybe')),
  comment text,
  updated_at timestamptz default now(),
  primary key (listing_id, person_id)
);

-- messages -------------------------------------------------------------------
-- listing_id null means the global thread
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  person_id uuid references people(id) not null,
  body text not null,
  created_at timestamptz default now()
);
create index if not exists messages_thread on messages (listing_id, created_at desc);

-- read markers ---------------------------------------------------------------
-- Deviation from SPEC: listing_id is NOT NULL here (null is not usable in a PK);
-- global thread read state lives in global_reads. This is the spec's own fallback.
create table if not exists thread_reads (
  person_id uuid references people(id),
  listing_id uuid not null references listings(id) on delete cascade,
  last_read_at timestamptz default now(),
  primary key (person_id, listing_id)
);

create table if not exists global_reads (
  person_id uuid primary key references people(id),
  last_read_at timestamptz default now()
);

-- activity -------------------------------------------------------------------
create table if not exists activity (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id) not null,
  verb text not null,        -- added_listing | edited_listing | changed_status | voted |
                             -- messaged | logged_interaction | added_broker |
                             -- set_next_action | updated_document | merged_listing
  entity_type text,          -- listing | broker | message | document
  entity_id uuid,
  summary text not null,     -- pre-rendered, e.g. "moved 214 Grand St to Tour scheduled"
  created_at timestamptz default now()
);
create index if not exists activity_recent on activity (created_at desc);

-- documents (Phase 5/6, links only, never files) ------------------------------
create table if not exists documents (
  id uuid primary key default gen_random_uuid(),
  person_id uuid references people(id),
  doc_type text not null,    -- pay_stubs | bank_statements | tax_return |
                             -- employment_letter | id | credit_report | guarantor_packet
  drive_url text,
  status text default 'missing',   -- missing | ready | expired
  updated_at timestamptz default now(),
  unique (person_id, doc_type)
);

create table if not exists doc_shares (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid references listings(id) on delete cascade,
  shared_with text,          -- broker email
  shared_by uuid references people(id),
  shared_at timestamptz default now(),
  revoked_at timestamptz
);
