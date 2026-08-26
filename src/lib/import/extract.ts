import "server-only";

/**
 * The one LLM call. A single forced tool use, so the model cannot answer with
 * prose, a preamble, or a JSON block wrapped in a code fence — it can only
 * fill in `record_listing`'s arguments or fail.
 *
 * Why an LLM at all: the alternative is per-site scrapers, and Zillow and
 * StreetEasy rename their DOM classes more often than we would ship fixes.
 * This also means the paste path — text copied out of *any* site, in any
 * shape — works with no extra code.
 *
 * Nothing here is trusted. `coerce.ts` re-checks every value.
 */

import Anthropic from "@anthropic-ai/sdk";
import type { RawExtract } from "./coerce";

export const IMPORT_MODEL = "claude-haiku-4-5-20251001";
const MAX_TOKENS = 1024;
const TOOL_NAME = "record_listing";

/** No `ANTHROPIC_API_KEY`. The route turns this into a 503, not a 500. */
export class ImportDisabledError extends Error {
  constructor(message = "Import isn't configured — ANTHROPIC_API_KEY is missing.") {
    super(message);
    this.name = "ImportDisabledError";
  }
}

/** The model was reachable and still gave us nothing usable. */
export class ExtractionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExtractionError";
  }
}

export function importEnabled(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY);
}

/**
 * The SDK client, built per call. Shared with `classify.ts` (the sync run's
 * second opinion) so there is one place that decides the key, the retry count
 * and the timeout — and one place that turns a missing key into
 * `ImportDisabledError` rather than a 500 from deep inside the SDK.
 */
export function anthropicClient(): Anthropic {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new ImportDisabledError();
  return new Anthropic({ apiKey, maxRetries: 1, timeout: 20_000 });
}

/** Anthropic's own failures, worded for a human. Shared with `classify.ts`. */
export function extractionErrorFor(error: unknown): ExtractionError {
  if (error instanceof Anthropic.APIError) {
    if (error.status === 401 || error.status === 403) {
      return new ExtractionError("The Anthropic API key was rejected.");
    }
    if (error.status === 429) {
      return new ExtractionError("Rate-limited by Anthropic — try again in a moment.");
    }
    return new ExtractionError(`Anthropic returned ${error.status ?? "an error"}.`);
  }
  return new ExtractionError("Couldn't reach Anthropic.");
}

const SYSTEM = [
  "You read New York City rental listings and record exactly what the page says.",
  "",
  "Rules:",
  "- Never guess. If the page does not state something, omit that field entirely.",
  '- "N/A", "-", "Contact agent", "Ask" and similar are absences: omit the field.',
  "- rent is the MONTHLY asking rent in whole US dollars. Ignore yearly figures, net-effective",
  "  vs gross distinctions (record the advertised price), deposits, and price-per-square-foot.",
  '- "No fee", "no broker fee", "fee-less" -> fee_type "no_fee". "OP", "owner pays", "owner paid"',
  '  -> fee_type "op". A stated tenant-paid fee -> "fee". Otherwise omit fee_type.',
  "- address is the street address only (e.g. \"214 Grand St\"). Put an apartment/unit number in",
  "  unit, never in address. Do not include the city, state or zip.",
  '- beds: a studio is 0. baths: half baths count as 0.5.',
  "- available_date must be yyyy-MM-dd. If the page only says \"immediately\" or \"now\", omit it.",
  "- trains: subway lines actually named on the page, e.g. \"J M Z\". Omit if none are named.",
  "- broker: the listing agent and their brokerage, if the page names them.",
  "- notes: at most 300 characters of genuinely notable amenities or terms",
  "  (laundry in unit, dishwasher, elevator, outdoor space, income requirements, lease length).",
  "  Not marketing copy, not the neighborhood description.",
  "- confidence: how sure you are that this text is ONE specific rental listing.",
  "  A search results page, a building page with many units, or a blocked/captcha page is < 0.4.",
].join("\n");

const TOOL: Anthropic.Tool = {
  name: TOOL_NAME,
  description:
    "Record the details of a single NYC rental listing exactly as stated on the page.",
  input_schema: {
    type: "object",
    properties: {
      address: { type: "string", description: "Street address only, no unit, no city." },
      unit: { type: "string", description: 'Apartment or unit number, e.g. "4B".' },
      neighborhood: { type: "string", description: 'e.g. "Bushwick", "Lower East Side".' },
      rent: { type: "integer", description: "Monthly asking rent in whole US dollars." },
      beds: { type: "number", description: "Bedrooms. A studio is 0." },
      baths: { type: "number", description: "Bathrooms. Half baths are 0.5." },
      sqft: { type: "integer", description: "Interior square feet, if stated." },
      available_date: { type: "string", description: "yyyy-MM-dd." },
      fee_type: { type: "string", enum: ["no_fee", "fee", "op", "unknown"] },
      broker_fee_pct: {
        type: "number",
        description: "Broker fee as a percent of annual rent, if stated.",
      },
      guarantor_ok: { type: "string", enum: ["yes", "no", "unknown"] },
      pets: { type: "string", enum: ["yes", "cats_only", "dogs_only", "no", "unknown"] },
      pet_notes: { type: "string", description: "Weight limits, deposits, breed rules." },
      trains: { type: "string", description: 'Subway lines named on the page, e.g. "J M Z".' },
      broker: {
        type: "object",
        properties: {
          name: { type: "string" },
          company: { type: "string" },
          phone: { type: "string" },
          email: { type: "string" },
        },
      },
      notes: { type: "string", description: "<= 300 chars of notable amenities or terms." },
      source_title: { type: "string", description: "The page's own title for this listing." },
      confidence: {
        type: "number",
        description: "0-1: how sure you are this is one specific rental listing.",
      },
    },
    required: ["confidence"],
  },
};

export type ExtractResult = {
  raw: RawExtract;
  usage: { input_tokens: number; output_tokens: number };
};

/**
 * `content` is the output of `buildPrompt` (a fetched page) or the user's
 * pasted text. `url` is context only — the model is told not to invent from it.
 */
export async function extractListing(
  content: string,
  opts: { url?: string | null } = {},
): Promise<ExtractResult> {
  if (!content.trim()) throw new ExtractionError("There was nothing to read.");

  const client = anthropicClient();

  const header = opts.url
    ? `The text below was taken from ${opts.url}.\n\n`
    : "The text below was pasted from a listing page.\n\n";

  let message: Anthropic.Message;
  try {
    message = await client.messages.create({
      model: IMPORT_MODEL,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      system: SYSTEM,
      tools: [TOOL],
      // Forced: the only valid reply is a filled-in `record_listing`.
      tool_choice: { type: "tool", name: TOOL_NAME },
      messages: [{ role: "user", content: `${header}${content}` }],
    });
  } catch (error) {
    throw extractionErrorFor(error);
  }

  const block = message.content.find(
    (part): part is Anthropic.ToolUseBlock =>
      part.type === "tool_use" && part.name === TOOL_NAME,
  );
  if (!block) throw new ExtractionError("The model didn't return any listing fields.");

  const usage = {
    input_tokens: message.usage.input_tokens,
    output_tokens: message.usage.output_tokens,
  };
  // Token spend is the whole cost of this feature; keep it visible in the logs.
  console.info("[import] extract", {
    model: IMPORT_MODEL,
    chars: content.length,
    stop_reason: message.stop_reason,
    ...usage,
  });

  return { raw: block.input as RawExtract, usage };
}
