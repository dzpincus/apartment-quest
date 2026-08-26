import Anthropic, { type APIError } from "@anthropic-ai/sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { extractionErrorFor } from "./extract";

/** What the API actually puts in the body of a 4xx. */
function apiError(status: number, type: string, message: string): APIError {
  return new Anthropic.APIError(
    status,
    { type: "error", error: { type, message } },
    `${status} ${message}`,
    new Headers({ "request-id": "req_123" }),
  );
}

describe("extractionErrorFor", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps the 401/403 and 429 wording", () => {
    expect(extractionErrorFor(apiError(401, "authentication_error", "x")).message).toBe(
      "The Anthropic API key was rejected.",
    );
    expect(extractionErrorFor(apiError(403, "permission_error", "x")).message).toBe(
      "The Anthropic API key was rejected.",
    );
    expect(extractionErrorFor(apiError(429, "rate_limit_error", "x")).message).toContain(
      "Rate-limited",
    );
  });

  it("puts the API's own message in a 400", () => {
    const error = extractionErrorFor(
      apiError(400, "invalid_request_error", "model: unknown\nmodel name"),
    );
    expect(error.message).toBe(
      "Anthropic rejected the request (400): model: unknown model name",
    );
    expect(error.message).not.toContain("\n");
  });

  it("trims a long 400 message to 200 characters of detail", () => {
    const error = extractionErrorFor(
      apiError(400, "invalid_request_error", "z".repeat(500)),
    );
    expect(error.message).toBe(`Anthropic rejected the request (400): ${"z".repeat(200)}`);
  });

  it("translates the credit-balance 400", () => {
    const error = extractionErrorFor(
      apiError(
        400,
        "invalid_request_error",
        "Your credit balance is too low to access the Anthropic API.",
      ),
    );
    expect(error.message).toBe(
      "Anthropic account has no credits — add billing at console.anthropic.com.",
    );
  });

  it("logs the status, type and request id", () => {
    extractionErrorFor(apiError(400, "invalid_request_error", "nope"));
    expect(console.error).toHaveBeenCalledWith(
      "[import] anthropic error",
      expect.objectContaining({
        status: 400,
        type: "invalid_request_error",
        request_id: "req_123",
      }),
    );
  });

  it("logs and reports a non-API failure", () => {
    const error = extractionErrorFor(new TypeError("fetch failed"));
    expect(error.message).toBe("Couldn't reach Anthropic.");
    expect(console.error).toHaveBeenCalledWith(
      "[import] anthropic error",
      expect.objectContaining({ name: "TypeError", message: "fetch failed" }),
    );
  });
});
