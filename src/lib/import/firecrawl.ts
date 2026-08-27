import "server-only";

/**
 * Rung two: pay someone with a browser farm to fetch the page for us.
 *
 * Optional by design — with no `FIRECRAWL_API_KEY` the ladder simply skips
 * this rung and goes straight to asking the user to paste. Firecrawl's free
 * tier is 500 credits, so this only runs when the direct fetch came back
 * blocked, never as the first attempt.
 *
 * **Timeouts are a pair, not one number.** A StreetEasy page behind
 * PerimeterX regularly takes Firecrawl 20-30 seconds to solve, render and hand
 * back, and at a 15s client timeout production said "The scraping service
 * didn't answer in time." far more often than the page was actually
 * unreachable. So Firecrawl gets its own `timeout` (35s — it is the one that
 * knows how long it has been trying) sitting *inside* our HTTP timeout (40s),
 * which exists only to stop a hung socket, not to cut short a scrape that is
 * still working. `waitFor` gives the bot wall's JavaScript a moment to settle
 * before the DOM is serialised.
 */

import { looksBlocked } from "./reduce";

const ENDPOINT = "https://api.firecrawl.dev/v1/scrape";

/** Our socket timeout. Deliberately longer than Firecrawl's own. */
export const FIRECRAWL_TIMEOUT_MS = 40_000;
/** Firecrawl's own budget for the scrape, sent in the body. */
const SCRAPE_TIMEOUT_MS = 35_000;
/** Let the page's JavaScript settle before the DOM is read. */
const WAIT_FOR_MS = 1_500;
/** One retry, because a timeout here is usually the queue and not the page. */
export const FIRECRAWL_RETRY_DELAY_MS = 2_000;
/**
 * The worst a single call can cost a caller's wall clock: two full attempts
 * and the pause between them. `/api/sync` budgets its run against this.
 */
export const FIRECRAWL_WORST_CASE_MS =
  FIRECRAWL_TIMEOUT_MS * 2 + FIRECRAWL_RETRY_DELAY_MS;

export type FirecrawlResult =
  | { ok: true; html: string; markdown: string; finalUrl: string }
  | { ok: false; reason: string };

export type ScrapeOptions = {
  /**
   * Try a second time after a timeout or a 5xx. On by default; `/api/import`
   * turns it off, because a person is watching that request and the rung
   * below it (the paste box) always works — see `scrapeWithFirecrawl`.
   */
  retry?: boolean;
};

export function firecrawlEnabled(): boolean {
  return Boolean(process.env.FIRECRAWL_API_KEY);
}

type ScrapeResponse = {
  success?: boolean;
  error?: string;
  data?: {
    html?: string;
    rawHtml?: string;
    markdown?: string;
    metadata?: { sourceURL?: string; url?: string; statusCode?: number };
  };
};

/** One HTTP call: a response, or a reason and whether trying again is sane. */
type Attempt =
  | { ok: true; res: Response }
  | { ok: false; reason: string; retryable: boolean };

/**
 * Scrape `url`, retrying once on a timeout or a 5xx.
 *
 * Only those two: a 4xx is our request or our credit balance, and a
 * `success: false` body is Firecrawl having read the page and not liked it.
 * Neither gets better by asking again, and both cost credits.
 */
export async function scrapeWithFirecrawl(
  url: string,
  { retry = true }: ScrapeOptions = {},
): Promise<FirecrawlResult> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { ok: false, reason: "Firecrawl isn't configured." };

  const started = Date.now();

  let attempt = await scrapeOnce(url, key);
  if (!attempt.ok && attempt.retryable && retry) {
    console.info("[firecrawl] retrying", { reason: attempt.reason });
    await sleep(FIRECRAWL_RETRY_DELAY_MS);
    attempt = await scrapeOnce(url, key);
  }
  if (!attempt.ok) return { ok: false, reason: attempt.reason };

  let body: ScrapeResponse;
  try {
    body = (await attempt.res.json()) as ScrapeResponse;
  } catch {
    return { ok: false, reason: "The scraping service sent something unreadable." };
  }

  const data = body.data;
  if (body.success === false || !data) {
    return { ok: false, reason: body.error ?? "The scraping service couldn't read the page." };
  }

  const html = data.html ?? data.rawHtml ?? "";
  const markdown = data.markdown ?? "";
  if (!html && !markdown) {
    return { ok: false, reason: "The scraping service came back empty." };
  }

  // Firecrawl will happily hand back the captcha page it was served.
  const blocked = looksBlocked(data.metadata?.statusCode ?? 200, html || markdown);
  if (blocked) return { ok: false, reason: blocked };

  console.info(`[firecrawl] took ${Date.now() - started}ms`);

  return {
    ok: true,
    html,
    markdown,
    finalUrl: data.metadata?.sourceURL ?? data.metadata?.url ?? url,
  };
}

async function scrapeOnce(url: string, key: string): Promise<Attempt> {
  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        url,
        formats: ["markdown", "html"],
        onlyMainContent: false,
        timeout: SCRAPE_TIMEOUT_MS,
        waitFor: WAIT_FOR_MS,
      }),
      signal: AbortSignal.timeout(FIRECRAWL_TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return {
      ok: false,
      reason: "The scraping service didn't answer in time.",
      retryable: true,
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: `The scraping service returned ${res.status}.`,
      // 5xx is their side having a moment; 4xx is us, or the credits.
      retryable: res.status >= 500,
    };
  }

  return { ok: true, res };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
