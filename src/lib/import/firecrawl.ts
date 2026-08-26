import "server-only";

/**
 * Rung two: pay someone with a browser farm to fetch the page for us.
 *
 * Optional by design — with no `FIRECRAWL_API_KEY` the ladder simply skips
 * this rung and goes straight to asking the user to paste. Firecrawl's free
 * tier is 500 credits, so this only runs when the direct fetch came back
 * blocked, never as the first attempt.
 */

import { looksBlocked } from "./reduce";

const ENDPOINT = "https://api.firecrawl.dev/v1/scrape";
const TIMEOUT_MS = 15_000;

export type FirecrawlResult =
  | { ok: true; html: string; markdown: string; finalUrl: string }
  | { ok: false; reason: string };

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

export async function scrapeWithFirecrawl(url: string): Promise<FirecrawlResult> {
  const key = process.env.FIRECRAWL_API_KEY;
  if (!key) return { ok: false, reason: "Firecrawl isn't configured." };

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ url, formats: ["markdown", "html"], onlyMainContent: false }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: "no-store",
    });
  } catch {
    return { ok: false, reason: "The scraping service didn't answer in time." };
  }

  if (!res.ok) {
    return { ok: false, reason: `The scraping service returned ${res.status}.` };
  }

  let body: ScrapeResponse;
  try {
    body = (await res.json()) as ScrapeResponse;
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

  return {
    ok: true,
    html,
    markdown,
    finalUrl: data.metadata?.sourceURL ?? data.metadata?.url ?? url,
  };
}
