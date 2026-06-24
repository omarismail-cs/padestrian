# Data

Datasets that power **Padestrian**’s walking zones: transit stops from GTFS and grocery locations from OSM. The GTFS export is gitignored (~270 MB); `groceries.geojson` is small enough to commit. See `manifest.json` for sources and snapshot metadata.

## groceries.geojson

**Full-size grocery stores** in the Ottawa area (weekly shop), from [OpenStreetMap](https://www.openstreetmap.org).

Included: `shop=supermarket` (Metro, Loblaws, Farm Boy, Sobeys, Superstore, Adonis, …) and **Costco warehouses** (`shop=wholesale`, not gas/pharmacy on the same lot).

Excluded by filter: Bulk Barn, spice/ethnic specialty markets, obvious mis-tags (see `padestrian/grocery_catalog.py`).

- **License:** [ODbL](https://www.openstreetmap.org/copyright)

### Refresh (recommended)

```bash
python -m padestrian fetch-groceries
python -m padestrian build-essentials
python -m padestrian build-zones          # ORS walk polygons for any new stores
python -m padestrian filter-listings
```

### Refresh yourself (Overpass Turbo)

1. Open [overpass-turbo.eu](https://overpass-turbo.eu/) and paste `data/overpass-groceries.ql`.
2. **Run** → **Export** → **GeoJSON**.
3. Save as `data/groceries.geojson`.
4. Run `build-essentials` and `build-zones` as above.

`fetch-groceries` applies the same Costco + denylist rules automatically.

**Note:** If a Sobeys / Superstore / Adonis is missing, it is usually **not mapped on OSM yet** (not a bug in the query). Add or fix the building on [openstreetmap.org](https://www.openstreetmap.org), then fetch again.

## GTFSExport/

[OC Transpo](https://www.octranspo.com) static schedule feed (GTFS).

| File | Role |
|------|------|
| `agency.txt` | Operator metadata |
| `stops.txt` | Stop locations |
| `routes.txt` | Route definitions |
| `trips.txt` | Scheduled trips |
| `stop_times.txt` | Arrival/departure times (largest file) |
| `shapes.txt` | Route geometry polylines |
| `calendar.txt` / `calendar_dates.txt` | Service calendars |
| `feed_info.txt` | Feed version and validity window |

Download a fresh export from OC Transpo when the feed expires (see `feed_start_date` / `feed_end_date` in `feed_info.txt`).

**In the app:** `stops.txt` supplies coordinates for permanent stops used as isochrone centers (walking zones to transit). Filter by `location_type` and route type as needed to drop stations-in-passing or non-passenger points.

## Generated files (from `python -m padestrian build-essentials`)

| File | Description |
|------|-------------|
| `public/data/stops.geojson` | OC Transpo boarding stops as points (`location_type` 0) |
| `public/data/groceries-points.geojson` | One point per grocery (centroid of building polygons) |
| `transit-hubs.geojson` | Curated hub stops for transit zone building (`build-transit-hubs`) |

Re-run the command after refreshing raw GTFS or Overpass exports.

## listings.json / listings.geojson

**Live catalog:** Kijiji + demo listings are stored in **Supabase** (`listings` table with PostGIS points). The map loads them via `GET /api/listings`. Static `public/data/listings-scored.geojson` remains as a fallback when Supabase is not configured.

Demo rental catalog for Ottawa (~180 mock listings). **Not live scrapes** — seeded for demos and recruiter loads.

| File | Role |
|------|------|
| `listings.json` | Source catalog (`id`, address, `lat`/`lon`, `rent_cad`, `bedrooms`, …) |
| `listings.geojson` | Map layer (generated) |

```bash
# Best: City of Ottawa municipal address points (download CSV from open data)
python -m padestrian import-municipal-addresses --csv "~/Downloads/Municipal_Address_....csv"
python -m padestrian seed-listings --source municipal
python -m padestrian validate-listings
python -m padestrian filter-listings
```

Pins use the same pattern as transit stops and groceries: **coordinates come from the source dataset**, not forward geocoding.

| Source | Dataset |
|--------|---------|
| **municipal** (recommended) | City address points CSV → `X`/`Y` (Web Mercator) + `FULL_ADDRESS_EN` |
| osm | Overpass building + `addr:*` tags |
| geocode | Mapbox forward geocode (legacy) |

Alternative OSM path: `fetch-osm-residential` then `seed-listings --source osm`.

`municipal-addresses.geojson` and the raw CSV are gitignored (large). Commit `listings.json` / `listings.geojson` for demos.

### Kijiji (live) listings

Scraped with `python -m padestrian scrape-listings`; snapshot in `listings.kijiji.json`. Bathroom counts:

- **New scrapes:** `normalize_listing` parses baths from attribute text, title, description, and URL slug.
- **Existing JSON** (title + URL only): `python -m padestrian backfill-bathrooms --fetch` reads each ad’s `vip-attributes-section` over HTTP (e.g. `1 Bathrooms`), then `validate-listings` and `filter-listings`.

**In-app refresh:** The sidebar has a refresh button next to "Kijiji/live listings" with two modes — *Prune* (remove dead ads + rescore) and *Prune + scrape* (also fetch new ads). Calls `/api/refresh-kijiji` which streams step-by-step progress while chaining the Python CLI commands. Requires a local Python environment.

### Personal Kijiji import (saved on your device)

Paste specific Kijiji listing URLs in the sidebar under **Kijiji/live listings** (expand the list). Imports are **not** added to the public Supabase catalog — they are stored in your browser (`localStorage`), same idea as the custom address pin.

| Path | Role |
|------|------|
| `POST /api/import-kijiji` | Scrape + geocode + score; returns GeoJSON features (no DB write) |
| `lib/saved-kijiji-imports.ts` | Persist personal imports in `localStorage` |
| `python -m padestrian import-kijiji --url URL` | Print GeoJSON to stdout (debug) |
| `python -m padestrian import-kijiji --url URL --to-db` | Owner: upsert into Supabase catalog |

Up to 3 URLs per import, 25 saved links max per browser.

## Walk zones (`data/zones/`)

Generated by `python -m padestrian build-zones` (gitignored). Per-center cache under `zones/cache/`; merged layers:

| File | Description |
|------|-------------|
| `grocery-10min.geojson` | All grocery walk polygons (default 10 min) |
| `grocery-15min.geojson` / `grocery-20min.geojson` | Same at 15 / 20 min (for the app walk-time slider) |
| `transit-10min.geojson` | Transit **hub** walk polygons (`build-transit-hubs` then `--transit`) |
| `transit-15min.geojson` / `transit-20min.geojson` | Hub zones at 15 / 20 min (for the app walk-time slider) |

**Transit hubs:** `python -m padestrian build-transit-hubs` exports ~40 curated OC Transpo stations (Transitway, O-Train, major P&R) from GTFS. `build-zones --transit` uses that file by default. Nearest-stop fallback still uses all of `stops.geojson`. Legacy first-N-stops behaviour: `--transit-all --transit-limit 200`.

## Web app: “Check an address”

The Next.js map can score **any Ottawa address** in the browser. It uses the same rules as `filter-listings`:

| Need | File |
|------|------|
| Grocery walk (required) | `zones/grocery-{10,15,20}min.geojson` (or `isochrones/smoke.geojson` fallback with `grocery_zone` role) |
| Transit walk | `zones/transit-{10,15,20}min.geojson` optional; `stops.geojson` always used for nearest-stop fallback |
| Rental pins on map | **`GET /api/listings`** (Supabase); fallback `listings-scored.geojson` |

Listings live in Supabase; `filter-listings` writes scores to the database. CI may export `public/data/listings-scored.geojson` as a static fallback only. Custom addresses are **not** stored in Supabase; they live in the user’s `localStorage` only.
