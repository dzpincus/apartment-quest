-- Apartment Quest — thread summaries
--
-- Applies after 0012. Re-runnable. No schema change — one function.
--
-- `/chat` stopped being "the group thread" and became a list of threads with
-- one of them open (Slack's shape). Drawing that list needs three facts per
-- thread — how many messages, when the last one landed, and what it said — and
-- the alternative to asking for them in one round trip is fetching every
-- message in the database and counting them in the browser.
--
-- One row per thread that has at least one message. `listing_id is null` is
-- the group thread, exactly as in `messages` and in `unread_counts` (0003).
-- A thread with no messages is not in here at all: the group thread is pinned
-- into the list client-side (`buildThreadList` in `src/lib/threads.ts`), and a
-- listing nobody has said anything about is not a conversation.
--
-- `security invoker` + `stable`, like `unread_counts`: RLS is the caller's, so
-- 0011's `is_app_user()` predicate on `messages` still decides what comes back,
-- and there is no `security definer` hole to reason about. No explicit grant,
-- also like `unread_counts` — `execute` on a new function is granted to
-- `public` by default, and 0011 only revoked that for `app_config`'s helper.
--
-- `set search_path = public` is restated because `create or replace` rewrites a
-- function's configuration along with its body (see CLAUDE.md → Database).

create or replace function thread_summaries()
returns table (
  -- null = the group thread.
  listing_id     uuid,
  message_count  bigint,
  last_at        timestamptz,
  last_body      text,
  last_person_id uuid
)
language sql
security invoker
stable
set search_path = public
as $$
  -- `distinct on (listing_id)` picks the newest row per thread, and the join
  -- brings the count with it. `is not distinct from` rather than `=`, because
  -- the group thread's key is NULL and `null = null` is null: with a plain `=`
  -- the group thread would come back with no count at all.
  --
  -- `m.id desc` is the tie-break. Two messages can share a `created_at` (the
  -- clock is `now()`, which is the transaction's, so a burst written together
  -- is written at the same instant), and without it the snippet in the list
  -- could change between two identical reads.
  --
  -- Every column reference is qualified and the subquery's key is renamed to
  -- `thread_id`, because a `returns table (...)` column is an OUT parameter and
  -- an OUT parameter's name is in scope inside a `language sql` body: a bare
  -- `listing_id` in there is `column reference "listing_id" is ambiguous`, and
  -- the function does not create at all. `unread_counts` (0003) qualifies
  -- everything for the same reason.
  select distinct on (m.listing_id)
    m.listing_id,
    c.message_count,
    m.created_at as last_at,
    m.body       as last_body,
    m.person_id  as last_person_id
  from messages m
  join (
    select all_m.listing_id as thread_id, count(*)::bigint as message_count
    from messages all_m
    group by all_m.listing_id
  ) c on c.thread_id is not distinct from m.listing_id
  order by m.listing_id, m.created_at desc, m.id desc;
$$;
