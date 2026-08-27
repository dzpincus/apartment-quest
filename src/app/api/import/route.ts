import "server-only";

/**
 * `POST /api/import` — the whole ladder in one request.
 *
 *   { url }  -> direct fetch -> Firecrawl (if configured) -> { blocked }
 *   { text } -> straight to extraction (the paste path always works)
 *
 * Two things this route must never do: 500 because a listing site refused us
 * (that is an expected outcome with a UI for it), and burn tokens for someone
 * who is not logged in. Hence the session check before anything else, and
 * `{ blocked: true }` as a 200.
 *
 * The first server-side secret in this app lives here. `ANTHROPIC_API_KEY` is
 * read only inside `extract.ts`, which imports `server-only`, so it cannot
 * reach a client bundle even by accident.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { listingLabel } from "@/lib/format";
import { assertSafeUrl, fetchPage, UnsafeUrlError } from "@/lib/import/fetch-page";
import { canonicalListingUrl } from "@/lib/import/canonical";
import { normalizeListingUrl } from "@/lib/url";
import { firecrawlEnabled, scrapeWithFirecrawl } from "@/lib/import/firecrawl";
import { buildPrompt, PROMPT_CAP, reduceHtml } from "@/lib/import/reduce";
import { discoverPhotos } from "@/lib/import/photos";
import {
  ExtractionError,
  extractListing,
  ImportDisabledError,
  importEnabled,
} from "@/lib/import/extract";
import { coerceExtract } from "@/lib/import/coerce";
import type { ImportResponse, ImportSource } from "@/lib/import/types";

export const runtime = "nodejs";
/** Fetch (8s) + Firecrawl (15s) + Haiku (20s) will not fit in Vercel's 10s default. */
export const maxDuration = 30;

const MAX_URL_CHARS = 2_048;
const MAX_TEXT_CHARS = 200_000;

type Body = { url?: unknown; text?: unknown; force?: unknown };

export async function POST(request: Request): Promise<NextResponse<ImportResponse>> {
  const started = Date.now();

  // --- auth first, before the body is read: one shared login, but the anon key
  // alone must not spend tokens — and a signed-out caller must not be able to
  // make us buffer 200k characters of paste before we tell them so.
  let supabase;
  try {
    supabase = await createClient();
  } catch {
    return NextResponse.json({ error: "Supabase isn't configured." }, { status: 500 });
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in first." }, { status: 401 });
  }

  let body: Body;
  try {
    body = (await request.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Expected a JSON body." }, { status: 400 });
  }

  if (!importEnabled()) {
    return NextResponse.json(
      { disabled: true, error: "Import isn't configured on this deployment." },
      { status: 503 },
    );
  }

  const url = typeof body.url === "string" ? body.url.trim() : "";
  const text = typeof body.text === "string" ? body.text : "";
  const force = body.force === true;

  if (!url && !text.trim()) {
    return NextResponse.json({ error: "Give me a link or some text." }, { status: 400 });
  }
  if (url.length > MAX_URL_CHARS) {
    return NextResponse.json({ error: "That link is absurdly long." }, { status: 400 });
  }
  if (text.length > MAX_TEXT_CHARS) {
    return NextResponse.json(
      { error: "That is more text than a listing page — paste less." },
      { status: 413 },
    );
  }

  let source: ImportSource;
  let promptText: string;
  let photos: string[] = [];
  let sourceUrl: string | null = null;
  /**
   * What goes in `listings.url`. Usually the link that was pasted — but a
   * StreetEasy *unit* page that names its own live `/rental/<id>` gets stored
   * as that instead, because the unit page carries the apartment's whole
   * history and the sync has to re-read it twice a day. See `canonical.ts`.
   */
  let storedUrl: string | null = null;

  if (url) {
    storedUrl = url;
    // Validate before anything else touches it, so a private address is a 400
    // rather than a request our server actually makes.
    try {
      await assertSafeUrl(url);
    } catch (error) {
      const message =
        error instanceof UnsafeUrlError ? error.message : "That link can't be imported.";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    if (!force) {
      const existing = await findListingByUrl(supabase, url);
      if (existing) return NextResponse.json(existing);
    }

    const tried: ImportSource[] = ["direct"];
    const direct = await fetchPage(url);
    let html = "";
    let markdown = "";

    if (direct.ok) {
      html = direct.html;
      sourceUrl = direct.finalUrl;
      source = "direct";
    } else if (firecrawlEnabled()) {
      tried.push("firecrawl");
      const scraped = await scrapeWithFirecrawl(url);
      if (!scraped.ok) {
        console.info("[import] blocked", { host: hostOf(url), tried, reason: scraped.reason });
        return NextResponse.json({ blocked: true, reason: scraped.reason, tried });
      }
      html = scraped.html;
      markdown = scraped.markdown;
      sourceUrl = scraped.finalUrl;
      source = "firecrawl";
    } else {
      console.info("[import] blocked", { host: hostOf(url), tried, reason: direct.reason });
      return NextResponse.json({ blocked: true, reason: direct.reason, tried });
    }

    if (html) {
      promptText = buildPrompt(reduceHtml(html));
      photos = discoverPhotos(html, { baseUrl: sourceUrl ?? url });
      storedUrl = canonicalListingUrl(url, html);
    } else {
      promptText = markdown.slice(0, PROMPT_CAP);
    }
  } else {
    source = "paste";
    sourceUrl = null;
    // A paste is usually text, but people paste view-source too — if it looks
    // like markup, it gets the same treatment a fetched page does (photos and
    // all), and if it does not, it goes straight to the model.
    if (/<\/?(?:html|body|div|script|meta)\b/i.test(text)) {
      promptText = buildPrompt(reduceHtml(text));
      photos = discoverPhotos(text);
    } else {
      promptText = text.slice(0, PROMPT_CAP);
    }
  }

  try {
    const { raw, usage } = await extractListing(promptText, { url: sourceUrl });
    const coerced = coerceExtract(raw, { url: storedUrl });

    console.info("[import] done", {
      source,
      host: url ? hostOf(url) : null,
      ms: Date.now() - started,
      canonicalized: Boolean(storedUrl && url && storedUrl !== url),
      filled: coerced.filledKeys.length,
      photos: photos.length,
      confidence: coerced.confidence,
      ...usage,
    });

    return NextResponse.json({
      fields: coerced.fields,
      broker: coerced.broker,
      filledKeys: coerced.filledKeys,
      photos,
      source,
      confidence: coerced.confidence,
      warnings: coerced.warnings,
      title: coerced.title,
    });
  } catch (error) {
    if (error instanceof ImportDisabledError) {
      return NextResponse.json({ disabled: true, error: error.message }, { status: 503 });
    }
    if (error instanceof ExtractionError) {
      return NextResponse.json({ error: error.message }, { status: 502 });
    }
    console.error("[import] failed", error);
    return NextResponse.json(
      { error: "Something went wrong reading that listing." },
      { status: 500 },
    );
  }
}

type ExistingRow = {
  id: string;
  address: string;
  unit: string | null;
  added_by_person: { name: string } | { name: string }[] | null;
};

/**
 * Re-importing a link someone already added is the single most likely way to
 * create a duplicate, and it happens before we have an address to dedupe on.
 * Cheap query, saves a whole LLM call.
 *
 * The match is on the *normalised* URL (`normalizeListingUrl`), because the
 * same listing arrives with a `?utm_source=`, a `#photos` and a trailing slash
 * depending on whether it was shared from an email, a phone or the address
 * bar. The raw string is still in the `in` list: rows written before
 * normalisation existed hold whatever was pasted that day.
 */
async function findListingByUrl(
  supabase: Awaited<ReturnType<typeof createClient>>,
  url: string,
) {
  const normalized = normalizeListingUrl(url);
  const candidates = normalized && normalized !== url ? [normalized, url] : [url];
  const { data, error } = await supabase
    .from("listings")
    .select("id, address, unit, added_by_person:people!added_by(name)")
    .in("url", candidates)
    .is("merged_into", null)
    .limit(1);
  if (error || !data || data.length === 0) return null;

  const row = data[0] as unknown as ExistingRow;
  const person = Array.isArray(row.added_by_person)
    ? (row.added_by_person[0] ?? null)
    : row.added_by_person;
  return {
    alreadyAdded: true as const,
    existingListingId: row.id,
    existingAddedBy: person?.name ?? null,
    existingLabel: listingLabel(row.address, row.unit),
  };
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}
