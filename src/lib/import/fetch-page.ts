import "server-only";

/**
 * Rung one of the ladder: ask the site for its own HTML, politely, once.
 *
 * Everything here is a limit. A URL the user typed is an instruction to make
 * an outbound request from a server that can reach things the user cannot, so:
 * http(s) only, no credentials in the URL, no odd ports, and the hostname must
 * resolve to a public address — re-checked on every redirect hop, because
 * `redirect: 'follow'` would happily walk from a public host to
 * `169.254.169.254` without telling us. Then 8 seconds, 2MB, and a hard stop.
 *
 * Known and accepted: this is a check-then-use race (the DNS answer we
 * validate is not provably the one the socket uses). Closing that needs a
 * custom agent with a per-connection callback; for a four-person app where
 * the only people who can reach this route are the four of us, the guard above
 * is the right amount of paranoia.
 */

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { looksBlocked } from "./reduce";

export const MAX_BYTES = 2 * 1024 * 1024;
export const FETCH_TIMEOUT_MS = 8_000;
const MAX_REDIRECTS = 3;

/** Chrome on macOS. Some sites 403 anything that admits to being a script. */
export const BROWSER_HEADERS: Record<string, string> = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
};

/** A URL we refuse to fetch at all. Maps to a 400, never a retry. */
export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeUrlError";
  }
}

export type PageResult =
  | { ok: true; html: string; finalUrl: string; status: number }
  | { ok: false; reason: string; status: number | null };

/** Parse, validate and DNS-check. Throws `UnsafeUrlError` on anything shady. */
export async function assertSafeUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new UnsafeUrlError("That isn't a URL.");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new UnsafeUrlError("Only http and https links can be imported.");
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError("Links with credentials in them aren't imported.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new UnsafeUrlError("Only the standard web ports can be imported.");
  }
  if (!url.hostname) throw new UnsafeUrlError("That isn't a URL.");

  // WHATWG keeps the brackets on an IPv6 host (`[::1]`), which is not
  // something `dns.lookup` accepts — strip them and judge the literal itself.
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(host) !== 0) {
    if (isBlockedAddress(host)) {
      throw new UnsafeUrlError("That address is on a private network.");
    }
    return url;
  }

  let addresses: { address: string }[];
  try {
    addresses = await lookup(host, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Couldn't resolve ${host}.`);
  }
  if (addresses.length === 0) throw new UnsafeUrlError(`Couldn't resolve ${host}.`);
  for (const { address } of addresses) {
    if (isBlockedAddress(address)) {
      throw new UnsafeUrlError("That address is on a private network.");
    }
  }
  return url;
}

/** Loopback, link-local, private, CGNAT, multicast, reserved — the lot. */
export function isBlockedAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return isBlockedV4(address);
  if (family === 6) return isBlockedV6(address);
  return true; // not an address we can reason about
}

function isBlockedV4(address: string): boolean {
  const parts = address.split(".").map(Number);
  if (parts.length !== 4 || parts.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
    return true;
  }
  const [a, b, c] = parts as [number, number, number, number];
  if (a === 0) return true; // "this network"
  if (a === 10) return true; // private
  if (a === 127) return true; // loopback
  if (a === 169 && b === 254) return true; // link-local, incl. cloud metadata
  if (a === 172 && b >= 16 && b <= 31) return true; // private
  if (a === 192 && b === 168) return true; // private
  if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
  if (a === 192 && b === 0 && (c === 0 || c === 2)) return true; // IETF protocol / TEST-NET-1
  if (a === 192 && b === 88 && c === 99) return true; // 6to4 relay anycast
  if (a === 198 && (b === 18 || b === 19)) return true; // benchmarking
  if (a === 198 && b === 51 && c === 100) return true; // TEST-NET-2
  if (a === 203 && b === 0 && c === 113) return true; // TEST-NET-3
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isBlockedV6(address: string): boolean {
  const bare = address.toLowerCase().split("%")[0] ?? "";
  const groups = expandV6(bare);
  if (!groups) return true;

  // IPv4-mapped (`::ffff:127.0.0.1`) and IPv4-compatible: judge the v4 part.
  const isMapped = groups.slice(0, 5).every((g) => g === 0) && groups[5] === 0xffff;
  const isCompat = groups.slice(0, 6).every((g) => g === 0) && groups[6] !== 0;
  if (isMapped || isCompat) {
    const g6 = groups[6] ?? 0;
    const g7 = groups[7] ?? 0;
    const v4 = [(g6 >> 8) & 0xff, g6 & 0xff, (g7 >> 8) & 0xff, g7 & 0xff].join(".");
    return isBlockedV4(v4);
  }

  if (groups.every((g) => g === 0)) return true; // ::
  if (groups.slice(0, 7).every((g) => g === 0) && groups[7] === 1) return true; // ::1

  const first = groups[0] ?? 0;
  if ((first & 0xfe00) === 0xfc00) return true; // fc00::/7 unique-local
  if ((first & 0xffc0) === 0xfe80) return true; // fe80::/10 link-local
  if ((first & 0xff00) === 0xff00) return true; // ff00::/8 multicast
  if (first === 0x2001 && (groups[1] ?? 0) === 0x0db8) return true; // documentation
  if (first === 0x0064 && (groups[1] ?? 0) === 0xff9b) return true; // NAT64
  return false;
}

/** `fd00::1` -> eight 16-bit groups, or `null` if it is not an address. */
function expandV6(address: string): number[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;

  const parseGroups = (part: string): number[] | null => {
    if (!part) return [];
    const out: number[] = [];
    for (const chunk of part.split(":")) {
      if (chunk.includes(".")) {
        const octets = chunk.split(".").map(Number);
        if (octets.length !== 4 || octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
          return null;
        }
        out.push((octets[0]! << 8) | octets[1]!, (octets[2]! << 8) | octets[3]!);
        continue;
      }
      if (!/^[0-9a-f]{1,4}$/.test(chunk)) return null;
      out.push(Number.parseInt(chunk, 16));
    }
    return out;
  };

  const head = parseGroups(halves[0] ?? "");
  const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const fill = 8 - head.length - tail.length;
  if (fill < 0) return null;
  return [...head, ...Array<number>(fill).fill(0), ...tail];
}

export async function fetchPage(raw: string): Promise<PageResult> {
  let current = raw;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // Throws for a bad or private target — including one a redirect chose.
    const url = await assertSafeUrl(current);

    let res: Response;
    try {
      res = await fetch(url, {
        redirect: "manual",
        headers: BROWSER_HEADERS,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        cache: "no-store",
      });
    } catch (error) {
      const timedOut = error instanceof Error && /timeout|abort/i.test(error.name);
      return {
        ok: false,
        status: null,
        reason: timedOut
          ? "The site took too long to answer."
          : "Couldn't reach the site.",
      };
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel().catch(() => {});
      if (!location) {
        return { ok: false, status: res.status, reason: "The site redirected nowhere." };
      }
      try {
        current = new URL(location, url).toString();
      } catch {
        return { ok: false, status: res.status, reason: "The site redirected somewhere odd." };
      }
      continue;
    }

    const type = res.headers.get("content-type") ?? "";
    if (type && !/text\/html|application\/xhtml|text\/plain|\+xml/i.test(type)) {
      await res.body?.cancel().catch(() => {});
      return { ok: false, status: res.status, reason: "That link isn't a web page." };
    }

    const html = await readCapped(res);
    const blocked = looksBlocked(res.status, html);
    if (blocked) return { ok: false, status: res.status, reason: blocked };
    return { ok: true, html, finalUrl: url.toString(), status: res.status };
  }

  return { ok: false, status: null, reason: "The site redirected too many times." };
}

/** Stop reading at `MAX_BYTES` instead of trusting `content-length`. */
async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      chunks.push(value);
      total += value.byteLength;
      if (total >= MAX_BYTES) {
        await reader.cancel().catch(() => {});
        break;
      }
    }
  } catch {
    // A truncated body is still worth reducing.
  }

  const buffer = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const charset = (res.headers.get("content-type") ?? "")
    .match(/charset=([^;]+)/i)?.[1]
    ?.trim()
    .replace(/['"]/g, "");
  try {
    return new TextDecoder(charset || "utf-8").decode(buffer);
  } catch {
    return new TextDecoder("utf-8").decode(buffer);
  }
}
