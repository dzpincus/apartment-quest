import { describe, expect, it } from "vitest";
import {
  fullscreenElement,
  fullscreenSupported,
  type FullscreenDoc,
  type FullscreenElement,
} from "./use-fullscreen";

const chrome: FullscreenDoc = { fullscreenEnabled: true, fullscreenElement: null };
const oldSafari: FullscreenDoc = { webkitFullscreenEnabled: true, webkitFullscreenElement: null };
/** iPhone: the property exists and says no, and elements cannot request it. */
const iphone: FullscreenDoc = { fullscreenEnabled: false, webkitFullscreenEnabled: false };

const div: FullscreenElement = { requestFullscreen: () => Promise.resolve() };
const webkitDiv: FullscreenElement = { webkitRequestFullscreen: () => {} };
const plain: FullscreenElement = {};

describe("fullscreenSupported", () => {
  it("is true for a standard element in a standard document", () => {
    expect(fullscreenSupported(chrome, div)).toBe(true);
  });

  it("accepts the webkit spellings on either side", () => {
    expect(fullscreenSupported(oldSafari, div)).toBe(true);
    expect(fullscreenSupported(chrome, webkitDiv)).toBe(true);
    expect(fullscreenSupported(oldSafari, webkitDiv)).toBe(true);
  });

  it("is false when the document forbids it", () => {
    expect(fullscreenSupported(iphone, div)).toBe(false);
  });

  it("is false when the document says nothing at all", () => {
    expect(fullscreenSupported({}, div)).toBe(false);
  });

  it("is false when the element cannot be asked — the iPhone case", () => {
    expect(fullscreenSupported(chrome, plain)).toBe(false);
    expect(fullscreenSupported(iphone, plain)).toBe(false);
  });

  it("is false for a ref that has not mounted yet", () => {
    expect(fullscreenSupported(chrome, null)).toBe(false);
    expect(fullscreenSupported(chrome, undefined)).toBe(false);
    expect(fullscreenSupported(null, div)).toBe(false);
  });

  it("does not treat a non-function property as a request method", () => {
    expect(
      fullscreenSupported(chrome, { requestFullscreen: undefined } as FullscreenElement),
    ).toBe(false);
  });
});

describe("fullscreenElement", () => {
  const el = { nodeName: "DIV" } as unknown as Element;

  it("reads either spelling, and null when nothing is full screen", () => {
    expect(fullscreenElement({ fullscreenElement: el })).toBe(el);
    expect(fullscreenElement({ webkitFullscreenElement: el })).toBe(el);
    expect(fullscreenElement(chrome)).toBeNull();
    expect(fullscreenElement({})).toBeNull();
  });

  it("prefers the standard property when both are present", () => {
    const other = { nodeName: "SPAN" } as unknown as Element;
    expect(fullscreenElement({ fullscreenElement: el, webkitFullscreenElement: other })).toBe(el);
  });
});
