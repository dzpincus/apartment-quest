import "server-only";

/**
 * `POST /api/sync` — go and look at every linked listing, twice a day.
 *
 * Four pg_cron jobs POST here (04:00, 05:00, 16:00 and 17:00 UTC) and the
 * route decides whether it is actually midnight or noon in New York; the two
 * that are not answer `{ skipped_hour_gate: true }` in a few milliseconds.
 * pg_cron has no timezone, so the alternative was re-scheduling twice a year.
 * See `supabase/cron.sql.example` and CLAUDE.md → "Sync".
 *
 * Two doors, because there are two callers with nothing in common:
 *
 * - **The cron**, with `Authorization: Bearer $CRON_SECRET`, no session and no
 *   cookies at all (compared in constant time; `src/lib/supabase/middleware.ts`
 *   lets this path past the signed-out guard).
 * - **A person**, pressing "Check now" on the detail page, which is a logged-in
 *   session and always names a single listing. A browser cannot hold
 *   CRON_SECRET, so `?listing=` is the only thing a session may ask for.
 *
 * What it will never do is decide a listing is `lost`. The sync writes
 * `listing_state` — what the *source page* says — and puts anything that looks
 * gone in front of a human on Home. Status is a decision, and decisions have
 * owners.
 */

import { NextResponse } from "next/server";
import { cronAuthorized, hasSession, UUID_RE } from "@/lib/api-auth";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";
import { listingLabel } from "@/lib/format";
import { nowNY } from "@/lib/time";
import { FETCH_TIMEOUT_MS, fetchPage } from "@/lib/import/fetch-page";
import {
  FIRECRAWL_WORST_CASE_MS,
  firecrawlEnabled,
  scrapeWithFirecrawl,
} from "@/lib/import/firecrawl";
import { buildPrompt, reduceHtml } from "@/lib/import/reduce";
import { importEnabled, MODEL_TIMEOUT_MS } from "@/lib/import/extract";
import {
  blockedNote,
  CLASSIFY_CAP,
  classifyFetched,
  classifyWithModel,
  isBlockedNote,
  needsModelConfirmation,
  transitionSummary,
  unconfirmedNote,
} from "@/lib/import/classify";
import {
  emptySync,
  errorNote,
  isManuallyConfirmedNote,
  learnedNothing,
  type SyncChange,
  type SyncOutcome,
  type SyncResponse,
} from "@/lib/sync-types";
import type { ListingState, Uuid } from "@/lib/types";

export const runtime = "nodejs";
/** 60 listings, three at a time, a few seconds each. Comfortably inside 300s. */
export const maxDuration = 300;
const MAX_DURATION_MS = maxDuration * 1_000;

/** Midnight and noon, New York. The whole point of the four UTC schedules. */
const SYNC_HOURS = new Set([0, 12]);
/** One run's budget. Oldest checks first, so the rest are next run's problem. */
const MAX_PER_RUN = 60;
const CONCURRENCY = 3;
/**
 * How long a site that walled us off stays exempt from the *paid* rung.
 * Firecrawl's free tier is 500 credits and 60 listings twice a day would eat
 * it in four days; a site that blocks us today will block us tomorrow.
 */
const BLOCK_COOLDOWN_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * The worst one check can cost: a direct fetch that times out, then two
 * Firecrawl attempts and the pause between them, then a model call. ~110s.
 */
const WORST_CHECK_MS = FETCH_TIMEOUT_MS + FIRECRAWL_WORST_CASE_MS + MODEL_TIMEOUT_MS;
/** Room after the pool for 60 UPDATEs and an activity row or two. */
const WRITE_HEADROOM_MS = 10_000;
/**
 * The wall clock, not the listing count. `maxDuration` is 300s and Vercel kills
 * the function at it — mid-write, with no response — so the pool stops handing
 * out work early and the leftovers are counted rather than lost. They sort
 * first next run: `state_checked_at` never moved, so they are the oldest rows.
 *
 * **The deadline is checked before a check starts, never during one**, so the
 * budget has to leave a whole worst-case check *plus* the writes behind it —
 * a listing picked up one millisecond inside the budget still runs to
 * completion. Derived rather than typed in, because it stopped being true the
 * moment Firecrawl's timeout went from 15s to 40s with a retry behind it:
 * 240s + 110s + writes is a killed function, not a budget. Today that is 180s.
 */
const RUN_BUDGET_MS = MAX_DURATION_MS - WORST_CHECK_MS - WRITE_HEADROOM_MS;

/** The columns a check reads. */
type Candidate = {
  id: Uuid;
  address: string;
  unit: string | null;
  url: string;
  listing_state: ListingState | null;
  state_checked_at: string | null;
  state_note: string | null;
};

/**
 * What one check came back with (`SyncOutcome` in `sync-types.ts`, where the
 * pure "may this overwrite `listing_state`?" decision lives beside it).
 */
type Outcome = SyncOutcome;

export async function POST(request: Request): Promise<NextResponse<SyncResponse>> {
  const started = Date.now();
  const params = new URL(request.url).searchParams;
  const listingId = (params.get("listing") ?? "").trim();
  const force = params.get("force") === "1";

  if (listingId && !UUID_RE.test(listingId)) {
    return json({ ...emptySync(), error: "Which listing?" }, 400);
  }

  if (!(await authorized(request, listingId))) {
    return json({ ...emptySync(), error: "Not for you." }, 401);
  }

  // A deployment without the keys is a deployment where this feature does not
  // exist — a 503 the cron can ignore, not a 500 anybody needs to debug.
  if (!adminEnabled() || !importEnabled()) {
    return json(
      {
        ...emptySync(),
        disabled: true,
        error: "Sync isn't configured on this deployment.",
      },
      503,
    );
  }

  // Both pg_cron pairs fire every day; only the New-York-matching one works.
  const hour = nowNY().getHours();
  if (!force && !SYNC_HOURS.has(hour)) {
    console.info("[sync] skipped", { nyHour: hour });
    return json({ ...emptySync(), skipped_hour_gate: true });
  }

  const admin = createAdminClient();

  let query = admin
    .from("listings")
    .select("id, address, unit, url, listing_state, state_checked_at, state_note")
    .not("url", "is", null)
    .is("merged_into", null)
    // A listing we passed on or lost is nobody's lead any more, and a null
    // status is a half-written row that still is.
    .or("status.is.null,status.not.in.(passed,lost)")
    .order("state_checked_at", { ascending: true, nullsFirst: true })
    .limit(listingId ? 1 : MAX_PER_RUN);
  if (listingId) query = query.eq("id", listingId);

  const { data, error } = await query;
  if (error) {
    console.error("[sync] candidate query failed", error);
    return json({ ...emptySync(), ran: true, error: "Couldn't read the listings." }, 500);
  }

  const candidates = (data ?? []) as Candidate[];
  // The pool checks the clock before it picks anything up, so a slow site late
  // in the run costs one check rather than the whole invocation's response.
  const outcomes = await pool(candidates, CONCURRENCY, (row) =>
    Date.now() - started > RUN_BUDGET_MS
      ? Promise.resolve<Outcome>({ kind: "skipped" })
      : inspect(row, { manual: Boolean(listingId) }),
  );

  const changed: SyncChange[] = [];
  let blocked = 0;
  let errors = 0;
  let skippedDeadline = 0;
  let botId: Uuid | null | undefined;
  let checkedListing: SyncResponse["checkedListing"];

  for (const [i, outcome] of outcomes.entries()) {
    const row = candidates[i] as Candidate;
    const before: ListingState = row.listing_state ?? "unknown";

    // We never got to this one. Nothing is written, which is the point: an
    // untouched `state_checked_at` puts it at the front of the next run.
    if (outcome.kind === "skipped") {
      skippedDeadline += 1;
      continue;
    }

    const checkedAt = new Date().toISOString();
    // A check that learned nothing may not overwrite what the last successful
    // one found — it only records that we tried, and why. That covers a block,
    // an error, *and* a page we fetched but could not classify: `unknown` over
    // a known `off_market` is a robot forgetting, not news. See
    // `learnedNothing` in `sync-types.ts`.
    const nothingLearned = learnedNothing(outcome, before);
    const note = outcome.kind === "error" ? errorNote(outcome.message) : outcome.note;
    const patch =
      outcome.kind !== "state" || nothingLearned
        ? { state_checked_at: checkedAt, state_note: note }
        : {
            listing_state: outcome.state,
            state_checked_at: checkedAt,
            state_note: note,
          };

    if (outcome.kind === "error") {
      errors += 1;
      console.error("[sync] check failed", { id: row.id, reason: outcome.message });
    }

    const { error: writeError } = await admin
      .from("listings")
      .update(patch)
      .eq("id", row.id);
    if (writeError) {
      // An error that also failed to write is still one failed check, not two.
      if (outcome.kind !== "error") errors += 1;
      console.error("[sync] write failed", { id: row.id, error: writeError.message });
      continue;
    }

    // A failed check has nothing to report to "Check now" beyond the failure;
    // leaving `checkedListing` unset is what makes the toast say so.
    if (outcome.kind === "error") continue;

    if (outcome.kind === "blocked") {
      blocked += 1;
      if (listingId) {
        checkedListing = { id: row.id, state: before, note: outcome.note, blocked: true };
      }
      continue;
    }

    // `before`, not `outcome.state`: when the page told us nothing, what this
    // listing *is* has not moved, and the detail page must not be handed an
    // `unknown` chip we just declined to store.
    if (listingId) {
      const state = nothingLearned ? before : outcome.state;
      checkedListing = { id: row.id, state, note: outcome.note, blocked: false };
    }
    if (nothingLearned || outcome.state === before) continue;

    const label = listingLabel(row.address, row.unit);
    changed.push({ id: row.id, label, from: before, to: outcome.state });

    // "Looks gone" and "is back up" are the only two worth a feed line; a
    // first sighting and anything sliding into `unknown` are not (classify.ts).
    const summary = transitionSummary(before, outcome.state, label, outcome.note);
    if (!summary) continue;
    botId ??= await botPersonId(admin);
    if (!botId) continue;
    const { error: activityError } = await admin.from("activity").insert({
      person_id: botId,
      verb: "listing_state_changed",
      entity_type: "listing",
      entity_id: row.id,
      summary,
    });
    if (activityError) console.error("[sync] activity insert failed", activityError);
  }

  const response: SyncResponse = {
    ran: true,
    skipped_hour_gate: false,
    checked: candidates.length,
    changed,
    blocked,
    errors,
    skipped_deadline: skippedDeadline,
    ...(checkedListing ? { checkedListing } : {}),
  };
  console.info("[sync] done", {
    nyHour: hour,
    forced: force,
    single: listingId || null,
    checked: response.checked,
    changed: changed.length,
    blocked,
    errors,
    skippedDeadline,
    ms: Date.now() - started,
  });
  return json(response);
}

// -- one listing --------------------------------------------------------------

/**
 * The ladder again, with a smaller appetite than the import's: direct fetch,
 * then Firecrawl but only when the site has not already proved it blocks us,
 * then regex, then — only for a page that says neither yes nor no — Haiku.
 */
async function inspect(
  row: Candidate,
  opts: { manual: boolean } = { manual: false },
): Promise<Outcome> {
  const url = row.url;
  let direct;
  try {
    direct = await fetchPage(url);
  } catch (error) {
    // An unsafe or unresolvable URL: a stored link, not a request we make.
    return { kind: "error", message: message(error) };
  }

  if (direct.ok) {
    return decide(
      {
        status: direct.status,
        finalUrl: direct.finalUrl,
        originalUrl: url,
        html: direct.html,
      },
      row,
    );
  }

  // A 404 is an answer, not a wall.
  if (direct.status === 404 || direct.status === 410) {
    return decide({ status: direct.status, finalUrl: url, originalUrl: url }, row);
  }

  // The cooldown is about not burning 500 free credits on a nightly crawl. A
  // person who pressed "Check now" is one credit and is asking on purpose, so
  // the paid rung is always open to them.
  if (firecrawlEnabled() && (opts.manual || !recentlyBlocked(row))) {
    let scraped;
    try {
      scraped = await scrapeWithFirecrawl(url);
    } catch (error) {
      return { kind: "error", message: message(error) };
    }
    if (scraped.ok) {
      return decide(
        {
          status: 200,
          finalUrl: scraped.finalUrl,
          originalUrl: url,
          html: scraped.html,
          markdown: scraped.markdown,
        },
        row,
      );
    }
    return { kind: "blocked", note: blockedNote(scraped.reason) };
  }

  return { kind: "blocked", note: blockedNote(direct.reason) };
}

type Page = {
  status: number;
  finalUrl: string;
  originalUrl: string;
  html?: string;
  markdown?: string;
};

/**
 * Cheap tiers first; the model for the pages they cannot call — **and** for the
 * one verdict they are not allowed to reach alone.
 *
 * A `off_market` that only the regex tier believes in gets a confirmation call.
 * That tier reads sentences on somebody else's website, and a StreetEasy unit
 * page whose price history said "No longer available" three times about three
 * dead listings walked a live $4,350 apartment into the Vanished section. The
 * structured tier and a 404 stand on their own; a phrase does not.
 *
 * When the model cannot be asked — no key, nothing to send, or the call itself
 * failed — the answer is `unknown` with the phrase kept in the note
 * (`unconfirmed: …`). `learnedNothing` then leaves `listing_state` exactly as
 * it was, which is the whole point: an unconfirmed phrase moves nothing.
 */
async function decide(page: Page, row: Candidate): Promise<Outcome> {
  const first = classifyFetched(page);

  if (first.state !== "ambiguous" && !needsModelConfirmation(first)) {
    return { kind: "state", state: first.state, note: first.note };
  }

  const confirming = first.state !== "ambiguous";
  const text = promptFor(page);

  if (!text.trim()) {
    // Nothing to send. An unconfirmable "gone" says so; an ambiguous page keeps
    // the note the classifier already wrote.
    return {
      kind: "state",
      state: "unknown",
      note: confirming ? unconfirmedNote(first.note) : first.note,
    };
  }

  let verdict;
  try {
    verdict = await classifyWithModel(text, { url: page.finalUrl || page.originalUrl });
  } catch (error) {
    if (!confirming) return { kind: "error", message: message(error) };
    // A failed confirmation is not a failed check — it is a "gone" we could not
    // stand behind, and the listing stays where it is.
    console.error("[sync] confirmation failed", { id: row.id, reason: message(error) });
    return { kind: "state", state: "unknown", note: unconfirmedNote(first.note) };
  }

  if (!confirming) return { kind: "state", state: verdict.state, note: verdict.note };

  const agrees = verdict.state === "off_market" || verdict.state === "removed";
  if (agrees) {
    // Both tiers, one note: the page's own words beat the model's paraphrase.
    return { kind: "state", state: verdict.state, note: first.note };
  }

  // The model read the whole page and did not see a dead listing. On a row a
  // human has already marked live, say so in the note — that is the case this
  // gate exists for.
  const manual = isManuallyConfirmedNote(row.state_note);
  console.info("[sync] confirmation declined", {
    id: row.id,
    regex: first.note,
    model: verdict.state,
    manuallyConfirmed: manual,
  });
  return verdict.state === "active"
    ? { kind: "state", state: "active", note: verdict.note }
    : { kind: "state", state: "unknown", note: unconfirmedNote(first.note) };
}

/** What the model is asked to read: the reduced page, capped. */
function promptFor(page: Page): string {
  return page.html
    ? buildPrompt(reduceHtml(page.html), CLASSIFY_CAP)
    : (page.markdown ?? "").slice(0, CLASSIFY_CAP);
}

/**
 * Has this site walled us off recently? `state_note` carries the answer
 * (`blocked — …`, written by `blockedNote`) and `state_checked_at` carries
 * when. Three days of not paying Firecrawl to be told no again.
 */
function recentlyBlocked(row: Candidate): boolean {
  if (!isBlockedNote(row.state_note)) return false;
  const last = row.state_checked_at ? Date.parse(row.state_checked_at) : Number.NaN;
  if (Number.isNaN(last)) return false;
  return Date.now() - last < BLOCK_COOLDOWN_MS;
}

// -- auth ---------------------------------------------------------------------

/**
 * The bearer token, or a session that is asking about one listing.
 *
 * `?listing=` is the whole of what a session may do: a browser cannot hold
 * CRON_SECRET, and a signed-in tab kicking off a 60-listing crawl by accident
 * (a double-clicked button, a refreshed URL) is not something to leave open.
 */
async function authorized(request: Request, listingId: string): Promise<boolean> {
  // The cron's door, then the person's — and a person may only ask about one
  // listing, which is the narrowing this route adds on top of the shared pair
  // in `src/lib/api-auth.ts`.
  if (cronAuthorized(request)) return true;
  if (!listingId) return false;
  return hasSession();
}

// -- helpers ------------------------------------------------------------------

/** `activity.person_id` is NOT NULL; Quest Bot is the row 0006 inserts. */
async function botPersonId(
  admin: ReturnType<typeof createAdminClient>,
): Promise<Uuid | null> {
  const { data, error } = await admin
    .from("people")
    .select("id")
    .eq("key", "bot")
    .maybeSingle();
  if (error) {
    console.error("[sync] bot lookup failed", error);
    return null;
  }
  // No bot row means 0006 has not been applied here. The states still get
  // written; only the feed line is skipped.
  if (!data) console.error("[sync] no 'bot' person — apply 0006_listing_sync.sql");
  return (data?.id as Uuid | undefined) ?? null;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function json(body: SyncResponse, status = 200): NextResponse<SyncResponse> {
  return NextResponse.json(body, { status });
}

/** Smallest possible worker pool: `size` runners off one shared cursor. */
async function pool<In, Out>(
  items: In[],
  size: number,
  run: (item: In) => Promise<Out>,
): Promise<Out[]> {
  const out = new Array<Out>(items.length);
  let cursor = 0;
  const worker = async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await run(items[i] as In);
    }
  };
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return out;
}
