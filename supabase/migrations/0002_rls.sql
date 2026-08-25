-- Apartment Quest — row level security
-- One shared login, no per-person boundary (intentional, see SPEC.md).
-- Every table: RLS on, one policy, authenticated only.

alter table people       enable row level security;
alter table brokers      enable row level security;
alter table listings     enable row level security;
alter table interactions enable row level security;
alter table votes        enable row level security;
alter table messages     enable row level security;
alter table thread_reads enable row level security;
alter table global_reads enable row level security;
alter table activity     enable row level security;
alter table documents    enable row level security;
alter table doc_shares   enable row level security;

drop policy if exists people_authenticated       on people;
drop policy if exists brokers_authenticated      on brokers;
drop policy if exists listings_authenticated     on listings;
drop policy if exists interactions_authenticated on interactions;
drop policy if exists votes_authenticated        on votes;
drop policy if exists messages_authenticated     on messages;
drop policy if exists thread_reads_authenticated on thread_reads;
drop policy if exists global_reads_authenticated on global_reads;
drop policy if exists activity_authenticated     on activity;
drop policy if exists documents_authenticated    on documents;
drop policy if exists doc_shares_authenticated   on doc_shares;

create policy people_authenticated on people
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy brokers_authenticated on brokers
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy listings_authenticated on listings
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy interactions_authenticated on interactions
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy votes_authenticated on votes
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy messages_authenticated on messages
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy thread_reads_authenticated on thread_reads
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy global_reads_authenticated on global_reads
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy activity_authenticated on activity
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy documents_authenticated on documents
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
create policy doc_shares_authenticated on doc_shares
  for all to authenticated using (auth.role() = 'authenticated') with check (auth.role() = 'authenticated');
