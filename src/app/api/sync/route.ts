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

import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { adminEnabled, createAdminClient } from "@/lib/supabase/admin";
import { listingLabel } from "@/lib/format";
import { nowNY } from "@/lib/time";
import { fetchPage } from "@/lib/import/fetch-page";
import { firecrawlEnabled, scrapeWithFirecrawl } from "@/lib/import/firecrawl";
import { buildPrompt, reduceHtml } from "@/lib/import/reduce";
import { importEnabled } from "@/lib/import/extract";
import {
  blockedNote,
  CLASSIFY_CAP,
  classifyFetched,
  classifyWithModel,
  isBlockedNote,
  transitionSummary,
} from "@/lib/import/classify";
import { EMPTY_SYNC, type SyncChange, type SyncResponse } from "@/lib/sync-types";
import type { ListingState, Uuid } from "@/lib/types";

export const runtime = "nodejs";
/** 60 listings, three at a time, a few seconds each. Comfortably inside 300s. */
export const maxDuration = 300;

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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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

type Outcome =
  /** We saw the page and have an opinion about it. */
  | { kind: "state"; state: ListingState; note: string }
  /** We never saw the page. State is left alone; only the timestamp moves. */
  | { kind: "blocked"; note: string }
  /** Something went wrong on our side. Nothing is written, so it retries. */
  | { kind: "error"; message: string };

export async function POST(request: Request): Promise<NextResponse<SyncResponse>> {
  const started = Date.now();
  const params = new URL(request.url).searchParams;
  const listingId = (params.get("listing") ?? "").trim();
  const force = params.get("force") === "1";

  if (listingId && !UUID_RE.test(listingId)) {
    return json({ ...EMPTY_SYNC, error: "Which listing?" }, 400);
  }

  if (!(await authorized(request, listingId))) {
    return json({ ...EMPTY_SYNC, error: "Not for you." }, 401);
  }

  // A deployment without the keys is a deployment where this feature does not
  // exist — a 503 the cron can ignore, not a 500 anybody needs to debug.
  if (!adminEnabled() || !importEnabled()) {
    return json(
      {
        ...EMPTY_SYNC,
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
    return json({ ...EMPTY_SYNC, skipped_hour_gate: true });
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
    return json({ ...EMPTY_SYNC, ran: true, error: "Couldn't read the listings." }, 500);
  }

  const candidates = (data ?? []) as Candidate[];
  const outcomes = await pool(candidates, CONCURRENCY, inspect);

  const changed: SyncChange[] = [];
  let blocked = 0;
  let errors = 0;
  let botId: Uuid | null | undefined;
  let checkedListing: SyncResponse["checkedListing"];

  for (const [i, outcome] of outcomes.entries()) {
    const row = candidates[i] as Candidate;
    const before: ListingState = row.listing_state ?? "unknown";

    if (outcome.kind === "error") {
      errors += 1;
      console.error("[sync] check failed", { id: row.id, reason: outcome.message });
      continue;
    }

    const checkedAt = new Date().toISOString();
    // A blocked check knows nothing, so it may not overwrite what the last
    // successful one found — it only records that we tried.
    const patch =
      outcome.kind === "blocked"
        ? { state_checked_at: checkedAt, state_note: outcome.note }
        : {
            listing_state: outcome.state,
            state_checked_at: checkedAt,
            state_note: outcome.note,
          };

    const { error: writeError } = await admin
      .from("listings")
      .update(patch)
      .eq("id", row.id);
    if (writeError) {
      errors += 1;
      console.error("[sync] write failed", { id: row.id, error: writeError.message });
      continue;
    }

    if (outcome.kind === "blocked") {
      blocked += 1;
      if (listingId) {
        checkedListing = { id: row.id, state: before, note: outcome.note, blocked: true };
      }
      continue;
    }

    if (listingId) {
      checkedListing = { id: row.id, state: outcome.state, note: outcome.note, blocked: false };
    }
    if (outcome.state === before) continue;

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
async function inspect(row: Candidate): Promise<Outcome> {
  const url = row.url;
  let direct;
  try {
    direct = await fetchPage(url);
  } catch (error) {
    // An unsafe or unresolvable URL: a stored link, not a request we make.
    return { kind: "error", message: message(error) };
  }

  if (direct.ok) {
    return decide({
      status: direct.status,
      finalUrl: direct.finalUrl,
      originalUrl: url,
      html: direct.html,
    });
  }

  // A 404 is an answer, not a wall.
  if (direct.status === 404 || direct.status === 410) {
    return decide({ status: direct.status, finalUrl: url, originalUrl: url });
  }

  if (firecrawlEnabled() && !recentlyBlocked(row)) {
    let scraped;
    try {
      scraped = await scrapeWithFirecrawl(url);
    } catch (error) {
      return { kind: "error", message: message(error) };
    }
    if (scraped.ok) {
      return decide({
        status: 200,
        finalUrl: scraped.finalUrl,
        originalUrl: url,
        html: scraped.html,
        markdown: scraped.markdown,
      });
    }
    return { kind: "blocked", note: blockedNote(scraped.reason) };
  }

  return { kind: "blocked", note: blockedNote(direct.reason) };
}

/** Regex first; the model only for the pages the regexes cannot call. */
async function decide(page: {
  status: number;
  finalUrl: string;
  originalUrl: string;
  html?: string;
  markdown?: string;
}): Promise<Outcome> {
  const first = classifyFetched(page);
  if (first.state !== "ambiguous") {
    return { kind: "state", state: first.state, note: first.note };
  }

  const text = page.html
    ? buildPrompt(reduceHtml(page.html), CLASSIFY_CAP)
    : (page.markdown ?? "").slice(0, CLASSIFY_CAP);
  if (!text.trim()) return { kind: "state", state: "unknown", note: first.note };

  try {
    const verdict = await classifyWithModel(text, { url: page.finalUrl || page.originalUrl });
    return { kind: "state", state: verdict.state, note: verdict.note };
  } catch (error) {
    return { kind: "error", message: message(error) };
  }
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
  const header = request.headers.get("authorization") ?? "";
  const bearer = /^Bearer\s+(.+)$/i.exec(header)?.[1]?.trim();
  if (bearer && secretMatches(bearer)) return true;
  if (!listingId) return false;

  try {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return Boolean(user);
  } catch {
    return false;
  }
}

/** Constant-time, and false when there is no secret to match at all. */
function secretMatches(candidate: string): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const a = Buffer.from(candidate);
  const b = Buffer.from(secret);
  // `timingSafeEqual` throws on a length mismatch, which would itself leak the
  // length; compare `a` with itself instead and return false regardless.
  if (a.length !== b.length) {
    timingSafeEqual(a, a);
    return false;
  }
  return timingSafeEqual(a, b);
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
