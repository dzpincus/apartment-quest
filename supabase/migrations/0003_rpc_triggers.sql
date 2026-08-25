-- Apartment Quest — triggers, RPCs, realtime publication

-- updated_at -----------------------------------------------------------------
create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists listings_set_updated_at on listings;
create trigger listings_set_updated_at
  before update on listings
  for each row execute function set_updated_at();

drop trigger if exists votes_set_updated_at on votes;
create trigger votes_set_updated_at
  before update on votes
  for each row execute function set_updated_at();

drop trigger if exists documents_set_updated_at on documents;
create trigger documents_set_updated_at
  before update on documents
  for each row execute function set_updated_at();

-- merge_listings -------------------------------------------------------------
-- Folds src into dst: children repointed, votes/reads kept if dst has none,
-- empty dst fields backfilled from src, src flagged merged_into = dst.
create or replace function merge_listings(src uuid, dst uuid)
returns void
language plpgsql
security invoker
as $$
begin
  if src = dst then
    raise exception 'cannot merge a listing into itself';
  end if;

  update interactions set listing_id = dst where listing_id = src;
  update messages     set listing_id = dst where listing_id = src;

  insert into votes (listing_id, person_id, vote, comment, updated_at)
  select dst, v.person_id, v.vote, v.comment, v.updated_at
  from votes v where v.listing_id = src
  on conflict (listing_id, person_id) do nothing;
  delete from votes where listing_id = src;

  insert into thread_reads (person_id, listing_id, last_read_at)
  select t.person_id, dst, t.last_read_at
  from thread_reads t where t.listing_id = src
  on conflict (person_id, listing_id) do nothing;
  delete from thread_reads where listing_id = src;

  update listings d set
    unit             = coalesce(d.unit, s.unit),
    neighborhood     = coalesce(d.neighborhood, s.neighborhood),
    rent             = coalesce(d.rent, s.rent),
    beds             = coalesce(d.beds, s.beds),
    baths            = coalesce(d.baths, s.baths),
    sqft             = coalesce(d.sqft, s.sqft),
    url              = coalesce(d.url, s.url),
    available_date   = coalesce(d.available_date, s.available_date),
    broker_fee_pct   = coalesce(d.broker_fee_pct, s.broker_fee_pct),
    guarantor_ok     = coalesce(d.guarantor_ok, s.guarantor_ok),
    trains           = coalesce(d.trains, s.trains),
    notes            = coalesce(d.notes, s.notes),
    broker_id        = coalesce(d.broker_id, s.broker_id)
  from listings s
  where d.id = dst and s.id = src;

  update listings set merged_into = dst where id = src;
end;
$$;

-- unread_counts --------------------------------------------------------------
-- One row per thread with unread messages. listing_id null = the global thread.
create or replace function unread_counts(p_person uuid)
returns table (listing_id uuid, unread bigint)
language sql
security invoker
stable
as $$
  select m.listing_id, count(*)::bigint as unread
  from messages m
  left join thread_reads tr on tr.listing_id = m.listing_id and tr.person_id = p_person
  left join global_reads gr on m.listing_id is null and gr.person_id = p_person
  where m.person_id <> p_person
    and m.created_at > coalesce(
      case when m.listing_id is null then gr.last_read_at else tr.last_read_at end,
      '-infinity'::timestamptz
    )
  group by m.listing_id;
$$;

-- realtime -------------------------------------------------------------------
-- Idempotent: `alter publication ... add table` errors if the table is already a member.
do $$
declare
  t text;
begin
  foreach t in array array['messages', 'listings', 'votes', 'activity', 'interactions'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end;
$$;
