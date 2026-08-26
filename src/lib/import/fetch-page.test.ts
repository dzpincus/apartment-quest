import { describe, expect, it } from "vitest";
import { assertSafeUrl, isBlockedAddress, UnsafeUrlError } from "./fetch-page";

/**
 * The SSRF guard. This route takes a URL from a text box and makes an outbound
 * request from a server that can reach a cloud metadata endpoint, so these are
 * the tests that matter most in the whole import feature.
 *
 * Every case here resolves offline (IP literals and `localhost`) — no test in
 * this file touches the network.
 */

describe("isBlockedAddress — IPv4", () => {
  it("blocks loopback, link-local and the private ranges", () => {
    for (const address of [
      "127.0.0.1",
      "127.1.2.3",
      "0.0.0.0",
      "10.0.0.1",
      "172.16.0.1",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254", // AWS/GCP metadata — the one this exists for
      "100.64.0.1", // carrier-grade NAT
      "192.0.0.1",
      "192.0.2.5",
      "198.18.0.1",
      "198.51.100.7",
      "203.0.113.7",
      "224.0.0.1",
      "255.255.255.255",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("allows ordinary public addresses", () => {
    for (const address of ["8.8.8.8", "1.1.1.1", "104.16.0.1", "172.32.0.1", "172.15.0.1"]) {
      expect(isBlockedAddress(address), address).toBe(false);
    }
  });

  it("blocks anything that is not an address at all", () => {
    expect(isBlockedAddress("not-an-ip")).toBe(true);
    expect(isBlockedAddress("")).toBe(true);
  });
});

describe("isBlockedAddress — IPv6", () => {
  it("blocks loopback, unique-local, link-local and multicast", () => {
    for (const address of [
      "::",
      "::1",
      "fc00::1",
      "fd12:3456::1",
      "fe80::1",
      "fe80::1%en0",
      "ff02::1",
      "2001:db8::1",
    ]) {
      expect(isBlockedAddress(address), address).toBe(true);
    }
  });

  it("sees through an IPv4-mapped address", () => {
    expect(isBlockedAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isBlockedAddress("::ffff:169.254.169.254")).toBe(true);
    expect(isBlockedAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("allows ordinary public addresses", () => {
    expect(isBlockedAddress("2606:4700::1111")).toBe(false);
    expect(isBlockedAddress("2001:4860:4860::8888")).toBe(false);
  });
});

describe("assertSafeUrl", () => {
  const rejects = async (url: string, match: RegExp) => {
    await expect(assertSafeUrl(url)).rejects.toThrow(UnsafeUrlError);
    await expect(assertSafeUrl(url)).rejects.toThrow(match);
  };

  it("refuses anything that is not http(s)", async () => {
    await rejects("ftp://example.com/a", /http and https/i);
    await rejects("file:///etc/passwd", /http and https/i);
    await rejects("javascript:alert(1)", /http and https/i);
    await rejects("data:text/html,hi", /http and https/i);
  });

  it("refuses text that is not a URL", async () => {
    await rejects("214 Grand St", /isn't a URL/i);
    await rejects("", /isn't a URL/i);
  });

  it("refuses credentials in the URL", async () => {
    await rejects("http://user:pass@example.com/", /credentials/i);
  });

  it("refuses non-web ports", async () => {
    await rejects("http://example.com:8080/", /standard web ports/i);
    await rejects("http://example.com:22/", /standard web ports/i);
  });

  it("refuses a host that resolves to a private address", async () => {
    await rejects("http://169.254.169.254/latest/meta-data/", /private network/i);
    await rejects("http://127.0.0.1/admin", /private network/i);
    await rejects("http://localhost/", /private network/i);
    await rejects("http://[::1]:80/", /private network/i);
  });

  it("returns the parsed URL when it is fine", async () => {
    // 8.8.8.8 as a literal: a real hostname would need DNS.
    const url = await assertSafeUrl("https://8.8.8.8/listing/1?x=2");
    expect(url.hostname).toBe("8.8.8.8");
    expect(url.pathname).toBe("/listing/1");
  });
});
