import { describe, expect, it, vi } from "vitest";
import {
  DUSK,
  duskCandy,
  duskCandyColor,
  lightness,
  cartoDarkStyle,
  loadMapStyle,
  CARTO_ATTRIBUTION,
  CARTO_DARK_TILE_URL,
  parseColor,
  resetMapStyleCache,
  type MapStyle,
} from "./map-style";

describe("parseColor", () => {
  it("reads the four shapes OpenFreeMap actually ships", () => {
    expect(parseColor("rgb(12,12,12)")).toEqual({ r: 12, g: 12, b: 12, a: 1 });
    // Spaces inside the argument list — a real string in the `dark` style.
    expect(parseColor("rgb(27 ,27 ,29)")).toEqual({ r: 27, g: 27, b: 29, a: 1 });
    expect(parseColor("rgba(60,60,60,0.8)")).toEqual({ r: 60, g: 60, b: 60, a: 0.8 });
    expect(parseColor("#181818")).toEqual({ r: 24, g: 24, b: 24, a: 1 });
    expect(parseColor("#000")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
  });

  it("reads hsl and hsla, including greys with a zero hue", () => {
    expect(parseColor("hsl(0,0%,0%)")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor("hsl(0,0%,100%)")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    const grey = parseColor("hsl(0,0%,27%)")!;
    expect(grey.r).toBe(grey.b);
    expect(grey.r).toBeCloseTo(69, 0);
    expect(parseColor("hsla(0,0%,85%,0.53)")?.a).toBe(0.53);
  });

  it("is total — expression operators are not colours", () => {
    for (const not of ["interpolate", "linear", "zoom", "", "  ", 12, null, undefined, ["#fff"]]) {
      expect(parseColor(not)).toBeNull();
    }
  });
});

describe("duskCandyColor", () => {
  it("maps black to the page and white to muted foreground", () => {
    expect(duskCandyColor("#000000")).toBe(DUSK.background);
    expect(duskCandyColor("#ffffff")).toBe(DUSK.label);
  });

  it("lands the style's water grey on the inset colour", () => {
    // rgb(27,27,29) sits within a rounding error of the ramp stop that is
    // `--inset`; the water *layer* is pinned exactly (see `duskCandy` below),
    // this is about everything else at that lightness landing beside it.
    const got = parseColor(duskCandyColor("rgb(27 ,27 ,29)"))!;
    const want = parseColor(DUSK.water)!;
    for (const ch of ["r", "g", "b"] as const) {
      expect(Math.abs(got[ch] - want[ch])).toBeLessThanOrEqual(2);
    }
  });

  it("keeps alpha, so a hairline casing stays a hairline", () => {
    expect(duskCandyColor("rgba(60,60,60,0.8)")).toMatch(/^rgba\(\d+,\d+,\d+,0\.8\)$/);
  });

  it("keeps lightness order — darker in, darker out", () => {
    const dark = parseColor(duskCandyColor("#0a0a0a"))!;
    const mid = parseColor(duskCandyColor("#3c3c3c"))!;
    const light = parseColor(duskCandyColor("#a0a0a0"))!;
    expect(lightness(dark)).toBeLessThan(lightness(mid));
    expect(lightness(mid)).toBeLessThan(lightness(light));
  });

  it("returns anything that is not a colour unchanged", () => {
    expect(duskCandyColor("wood-pattern")).toBe("wood-pattern");
  });
});

/** A trimmed copy of the shapes OpenFreeMap's `dark` style is made of. */
function style(): MapStyle {
  return {
    version: 8,
    sources: { openmaptiles: { type: "vector", url: "https://tiles.example/planet" } },
    layers: [
      { id: "background", type: "background", paint: { "background-color": "rgb(12,12,12)" } },
      {
        id: "water",
        type: "fill",
        paint: { "fill-antialias": false, "fill-color": "rgb(27 ,27 ,29)" },
      },
      {
        id: "building",
        type: "fill",
        paint: { "fill-color": "rgb(10,10,10)", "fill-outline-color": "rgb(27 ,27 ,29)" },
      },
      {
        id: "highway_motorway_inner",
        type: "line",
        paint: {
          "line-color": ["interpolate", ["linear"], ["zoom"], 5.8, "hsla(0,0%,85%,0.53)", 6, "#000"],
          "line-width": ["interpolate", ["exponential", 1.4], ["zoom"], 4, 2, 20, 30],
        },
      },
      {
        id: "place_city",
        type: "symbol",
        layout: { "text-field": "{name}", "text-font": ["Noto Sans Regular"] },
        paint: {
          "text-color": "rgb(101,101,101)",
          "text-halo-color": "rgba(0,0,0,0.7)",
          "text-halo-width": 1,
        },
      },
      { id: "road_oneway", type: "symbol", paint: { "icon-opacity": 0.5 } },
    ],
  };
}

describe("duskCandy", () => {
  const out = duskCandy(style());
  const layer = (id: string) => out.layers.find((l) => l.id === id)!;

  it("pins the page, the water and the label colours", () => {
    expect(layer("background").paint!["background-color"]).toBe(DUSK.background);
    expect(layer("water").paint!["fill-color"]).toBe(DUSK.water);
    expect(layer("place_city").paint!["text-color"]).toBe(DUSK.label);
    expect(layer("place_city").paint!["text-halo-color"]).toBe(DUSK.halo);
  });

  it("recolours inside expressions and leaves the numbers alone", () => {
    const line = layer("highway_motorway_inner").paint!["line-color"] as unknown[];
    expect(line[0]).toBe("interpolate");
    expect(line[3]).toBe(5.8);
    expect(line[4]).toMatch(/^rgba\(/);
    expect(line[6]).toBe(DUSK.background);
    expect(layer("highway_motorway_inner").paint!["line-width"]).toEqual(
      style().layers.find((l) => l.id === "highway_motorway_inner")!.paint!["line-width"],
    );
  });

  it("touches nothing that is not a `-color` property", () => {
    expect(layer("water").paint!["fill-antialias"]).toBe(false);
    expect(layer("road_oneway").paint!["icon-opacity"]).toBe(0.5);
    expect(layer("place_city").layout).toEqual({
      "text-field": "{name}",
      "text-font": ["Noto Sans Regular"],
    });
  });

  it("does not mutate the style it was handed", () => {
    const source = style();
    duskCandy(source);
    expect(source.layers[0].paint!["background-color"]).toBe("rgb(12,12,12)");
  });

  it("keeps sources and version, so it is still a loadable style", () => {
    expect(out.version).toBe(8);
    expect(out.sources).toEqual(style().sources);
    expect(out.layers).toHaveLength(style().layers.length);
  });
});

describe("loadMapStyle", () => {
  it("fetches once and recolours what comes back", async () => {
    resetMapStyleCache();
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(style())));
    const first = await loadMapStyle(fetchImpl as unknown as typeof fetch, "https://x/style");
    const second = await loadMapStyle(fetchImpl as unknown as typeof fetch, "https://x/style");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    expect(first.layers[0].paint!["background-color"]).toBe(DUSK.background);
    resetMapStyleCache();
  });

  it("falls back to CARTO raster rather than rejecting, and drops the cache", async () => {
    resetMapStyleCache();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("nope", { status: 500 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(style())));

    // A map, not a rejection: OpenFreeMap being down must not cost the pins.
    const lifeboat = await loadMapStyle(fetchImpl as unknown as typeof fetch, "https://x/style");
    expect(lifeboat.layers.map((l) => l.type)).toContain("raster");
    expect(JSON.stringify(lifeboat.sources)).toContain(CARTO_DARK_TILE_URL);
    expect(JSON.stringify(lifeboat.sources)).toContain(CARTO_ATTRIBUTION);

    // …and the next map still asks OpenFreeMap rather than inheriting it.
    const retried = await loadMapStyle(fetchImpl as unknown as typeof fetch, "https://x/style");
    expect(retried.version).toBe(8);
    expect(retried.layers[0].paint!["background-color"]).toBe(DUSK.background);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    warn.mockRestore();
    resetMapStyleCache();
  });
});

describe("cartoDarkStyle", () => {
  it("is a fresh object each call — MapLibre mutates the style it is given", () => {
    expect(cartoDarkStyle()).not.toBe(cartoDarkStyle());
    expect(cartoDarkStyle()).toEqual(cartoDarkStyle());
  });

  it("carries its attribution, which is a licence term and not decoration", () => {
    const source = cartoDarkStyle().sources.carto as { attribution: string };
    expect(source.attribution).toBe("© OpenStreetMap contributors © CARTO");
  });
});
