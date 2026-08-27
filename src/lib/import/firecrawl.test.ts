import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  FIRECRAWL_RETRY_DELAY_MS,
  FIRECRAWL_WORST_CASE_MS,
  scrapeWithFirecrawl,
} from "./firecrawl";

/**
 * Rung two of the import ladder, with the network mocked.
 *
 * The thing worth testing here is the retry, and specifically *what* it will
 * try again: a timeout or a 5xx is Firecrawl's queue having a moment, and a
 * StreetEasy page behind a bot wall regularly takes long enough to hit one. A
 * 4xx and a `success: false` body are answers — asking twice costs a credit
 * and gets the same sentence back.
 */

const URL_UNDER_TEST = "https://streeteasy.com/rental/1234567";

/**
 * What Firecrawl hands back when it worked. The `og:title` matters: without
 * some structured markup on it, `looksBlocked` calls a short page a
 * renders-in-the-browser shell and this stops being a success case.
 */
const OK_HTML =
  '<html><head><meta property="og:title" content="214 Grand St #4B"></head>' +
  "<body>A perfectly ordinary listing, $4,350/mo, 2 beds</body></html>";

function page(html = OK_HTML) {
  return new Response(
    JSON.stringify({
      success: true,
      data: {
        html,
        markdown: "A perfectly ordinary listing",
        metadata: { sourceURL: URL_UNDER_TEST, statusCode: 200 },
      },
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

/** An `AbortSignal.timeout` firing looks like this to the caller. */
function timedOut(): Promise<Response> {
  return Promise.reject(new DOMException("The operation was aborted.", "TimeoutError"));
}

/** Drive a call that sleeps between attempts to completion. */
async function run<T>(promise: Promise<T>): Promise<T> {
  await vi.advanceTimersByTimeAsync(FIRECRAWL_RETRY_DELAY_MS);
  return promise;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubEnv("FIRECRAWL_API_KEY", "fc-test-key");
  vi.spyOn(console, "info").mockImplementation(() => {});
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("scrapeWithFirecrawl — the request", () => {
  it("asks Firecrawl for both formats and gives it its own timeout", async () => {
    fetchMock.mockResolvedValue(page());

    await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(body.url).toBe(URL_UNDER_TEST);
    expect(body.formats).toEqual(["markdown", "html"]);
    expect(body.onlyMainContent).toBe(false);
    // Firecrawl's own budget has to sit *inside* our socket timeout, or we
    // hang up on a scrape that was about to answer.
    expect(body.timeout).toBe(35_000);
    expect(body.waitFor).toBe(1_500);
  });

  it("logs how long a successful scrape took", async () => {
    fetchMock.mockResolvedValue(page());

    await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(console.info).toHaveBeenCalledWith(expect.stringMatching(/^\[firecrawl] took \d+ms$/));
  });

  it("is configured out of existence without a key", async () => {
    vi.stubEnv("FIRECRAWL_API_KEY", "");

    const result = await scrapeWithFirecrawl(URL_UNDER_TEST);

    expect(result).toEqual({ ok: false, reason: "Firecrawl isn't configured." });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("scrapeWithFirecrawl — the retry", () => {
  it("tries again after a timeout and keeps the second answer", async () => {
    fetchMock.mockImplementationOnce(timedOut).mockResolvedValueOnce(page());

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true, finalUrl: URL_UNDER_TEST });
  });

  it("waits before trying again rather than hammering the queue", async () => {
    fetchMock.mockImplementationOnce(timedOut).mockResolvedValueOnce(page());

    const promise = scrapeWithFirecrawl(URL_UNDER_TEST);
    // Let the first attempt fail and the sleep start, but do not finish it.
    await vi.advanceTimersByTimeAsync(FIRECRAWL_RETRY_DELAY_MS - 1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await promise;
  });

  it("tries again after a 5xx", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("upstream is sulking", { status: 502 }))
      .mockResolvedValueOnce(page());

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toMatchObject({ ok: true });
  });

  it("gives up after the second attempt, with the second one's reason", async () => {
    fetchMock
      .mockImplementationOnce(timedOut)
      .mockResolvedValueOnce(new Response("", { status: 503 }));

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ ok: false, reason: "The scraping service returned 503." });
  });

  it("does not retry a 4xx — that is our request or our credits", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 402 }));

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: "The scraping service returned 402." });
  });

  it("does not retry a page Firecrawl read and could not use", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ success: false, error: "This page is a PDF." }), {
        status: 200,
      }),
    );

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ ok: false, reason: "This page is a PDF." });
  });

  it("makes one attempt only when the caller has somebody waiting", async () => {
    fetchMock.mockImplementation(timedOut);

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST, { retry: false }));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      ok: false,
      reason: "The scraping service didn't answer in time.",
    });
  });

  it("still reports a captcha as a block, not as something to retry", async () => {
    fetchMock.mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          data: {
            html: "<html><body>Press and hold to confirm you are a human</body></html>",
            metadata: { statusCode: 403 },
          },
        }),
        { status: 200 },
      ),
    );

    const result = await run(scrapeWithFirecrawl(URL_UNDER_TEST));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.ok).toBe(false);
  });
});

describe("FIRECRAWL_WORST_CASE_MS", () => {
  it("is what /api/sync subtracts from its 300s: two attempts and the pause", () => {
    expect(FIRECRAWL_WORST_CASE_MS).toBe(82_000);
  });
});
