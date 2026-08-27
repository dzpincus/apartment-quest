# Notices and attributions

Apartment Quest is MIT-licensed (see [LICENSE](LICENSE)). It bundles, calls or
displays the third-party work listed below. Some of these entries are courtesy;
the ones marked **required** are licence or terms-of-service conditions, and
removing them from a deployment is a violation rather than a style choice.

---

## MapLibre GL JS — BSD-3-Clause

Map rendering. Installed from npm as `maplibre-gl`, and **partly vendored**:
`scripts/copy-maplibre-worker.mjs` copies MapLibre's worker bundles into
`public/maplibre-gl-worker.mjs` and `public/maplibre-gl-shared.mjs` so the
worker is served same-origin. Those two files are redistributed copies of
MapLibre's compiled output, which is why the notice below is reproduced in full.

MapLibre's own attribution control must stay visible on every map — the library
is BSD, but the *data* it renders is not (see OpenStreetMap, below).

> Copyright (c) 2023, MapLibre contributors
>
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are met:
>
> * Redistributions of source code must retain the above copyright notice, this
>   list of conditions and the following disclaimer.
> * Redistributions in binary form must reproduce the above copyright notice,
>   this list of conditions and the following disclaimer in the documentation
>   and/or other materials provided with the distribution.
> * Neither the name of MapLibre GL JS nor the names of its contributors may be
>   used to endorse or promote products derived from this software without
>   specific prior written permission.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
> AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
> IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
> DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE
> FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
> DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
> SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
> CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
> OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
> OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

MapLibre GL JS contains code from mapbox-gl-js v1.13 and earlier, which is
licensed under its own BSD-3-Clause terms (Copyright (c) 2020, Mapbox). The full
upstream text, including that section and the licences of MapLibre's own
dependencies, ships with the package at `node_modules/maplibre-gl/LICENSE.txt`.

## OpenFreeMap and OpenStreetMap — ODbL 1.0 (**required**)

The default basemap is [OpenFreeMap](https://openfreemap.org/)'s `dark` style,
fetched at runtime and recoloured by `src/components/map/map-style.ts`. The
underlying data is © [OpenStreetMap](https://www.openstreetmap.org/copyright)
contributors, licensed under the
[Open Database License](https://opendatacommons.org/licenses/odbl/).

**Attribution is required and is rendered by MapLibre's attribution control on
every map in the app.** Recolouring the style does not change this; the transform
touches `paint` properties only and never the attribution.

## CARTO basemaps — fallback (**required when shown**)

When the OpenFreeMap style fetch fails, `loadMapStyle` falls back to CARTO's
keyless dark raster tiles, and the attribution control changes with it to
© OpenStreetMap contributors © [CARTO](https://carto.com/attributions).

## MTA subway stations — NY Open Data

`public/data/subway-stations.geojson` is derived from the MTA's *Subway
Stations* dataset published on [NY Open Data](https://data.ny.gov/), dataset id
[`39hk-dx4f`](https://data.ny.gov/d/39hk-dx4f). It has been trimmed to
`{ name, lines }` per station **complex** and rounded to five decimal places —
445 features, ~60 KB. The file is bundled and served statically; the app makes
no request to NY Open Data at runtime.

## NYC Planning Labs GeoSearch

Rung one of geocoding is [NYC GeoSearch](https://geosearch.planninglabs.nyc/)
(`geosearch.planninglabs.nyc`), a Pelias instance run by NYC Planning Labs over
the City's own address data. Free, keyless, NYC-only.

## Nominatim — usage policy (**required**)

Rung two of geocoding is [Nominatim](https://nominatim.org/), governed by the
[OSM Foundation's Nominatim usage
policy](https://operations.osmfoundation.org/policies/nominatim/). Two of its
conditions are implemented rather than assumed:

- **At most one request per second.** Serialised through a queue in
  `src/lib/geo/geocode.ts`, so a "Locate all" over sixty listings waits its turn.
- **An identifying `User-Agent` with a way to contact the operator.** Built from
  the `NOMINATIM_CONTACT` environment variable as `apartment-quest (<contact>)`.
  **Unset means the rung is skipped entirely** — there is deliberately no
  fall-through to an anonymous call, because that is what gets an application
  blocked for everyone. Set it to your own email address or the URL of your fork;
  do not inherit someone else's.

Results are © OpenStreetMap contributors, ODbL.

## Google Routes API — "Powered by Google" (**required**)

Walk, bike and transit durations come from the Google Routes API
(`computeRoutes`), server-side. Google's terms permit displaying results
*without* a Google map only alongside a **Powered by Google** credit, so
`src/components/listings/powered-by-google.tsx` is rendered in all three places a
duration reaches a screen: the detail card's commute table, the listings table
and the mobile cards. Removing it is a licence violation.

Use of the API is subject to the [Google Maps Platform Terms of
Service](https://cloud.google.com/maps-platform/terms).

## Anthropic — Claude

Listing extraction (`/api/import`) and sync classification (`/api/sync`) each
make one forced tool call to `claude-haiku-4-5` via the
[`@anthropic-ai/sdk`](https://github.com/anthropics/anthropic-sdk-typescript)
package, subject to Anthropic's [usage
policies](https://www.anthropic.com/legal/aup) and commercial terms. Requires
your own `ANTHROPIC_API_KEY`; without one the feature is disabled rather than
broken.

## Firecrawl

Optional rung two of the import ladder, used only when a site blocks a direct
fetch. Subject to [Firecrawl](https://firecrawl.dev/)'s terms. Requires your own
`FIRECRAWL_API_KEY`; without one the ladder drops straight to the paste box.

---

## Listing sites

The app fetches a listing page **only** when a human pastes that specific URL. It
does not crawl, does not read search or index pages, does not use any listing
site's API and does not drive a headless browser. Whether a given fetch is
permitted is between the operator of a deployment and the site's terms of use.
