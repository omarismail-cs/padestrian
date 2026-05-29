# Padestrian

**Find rentals you can actually live in without a car — on one map.**

Padestrian is a full-stack Ottawa rental explorer built around a simple idea: **walkability should mean a real walk**, not a straight line on a map. Most listing sites hand you a generic score that ignores highways, missing sidewalks, and how long winter walks actually feel. This project scores each apartment using **pedestrian routing**, official **transit stop data**, and real **grocery locations**, then shows you the results instantly.

## Screenshots

**Map** — color-coded rentals, groceries, transit stops, and a listing card with walkability badge:

![Padestrian map with walkable listing popup](public/images/screenshot-map.png)

**Filters & layers** — rent, bedrooms, walkable-only toggle, legend, and grocery/transit/Kijiji sources:

![Padestrian filter panel and layer controls](public/images/screenshot-filters.png)

---

## Why this exists

Apartment hunting without a car usually means:

- Rental site in one tab, Google Maps in another  
- Guessing whether “15 minutes to transit” includes a fence, a parking lot, or a road with no sidewalk  
- No single view of **price + location + grocery + bus** at once  

Padestrian puts that in one place: hover a pin, see rent and address, know at a glance if the listing is walkable to **both** transit and a full grocery store.

---

## What you’ll see when you run it

- **Interactive Mapbox map** with dark/light theme, rent and bedroom filters, and a “walkable only” toggle  
- **~180 demo listings** placed on real City of Ottawa address coordinates (not random pins)  
- **Color-coded house markers** — walkable, grocery-only, transit-only, or neither  
- **Grocery + transit layers** you can turn on and off  
- **Listing cards** on hover (price, beds/baths, address, Kijiji link when available)  
- **Optional live Kijiji import** via the Python CLI (batch scrape → score → map)

---

## How it works (the interesting part)

```text
Listings (JSON)     Groceries (OSM)        Transit (GTFS)
       │                    │                      │
       └────────────► 10-min walk zones ◄─────────┘
                    (OpenRouteService isochrones)
                              │
                              ▼
              Point-in-polygon + nearest-stop check
                              │
                              ▼
                 listings-scored.geojson → Map
```

1. **Listings** land on the map with real lat/lon from municipal address points (demo set) or imported Kijiji ads.  
2. **Groceries** come from OpenStreetMap; **transit stops** from OC Transpo GTFS.  
3. **Walk zones** are built with OpenRouteService — actual sidewalk/path routing for a **10-minute** budget, drawn as polygons around each store (and optionally stops).  
4. Each listing is scored: near grocery? near transit? **eligible** only when both are true.  
5. The Next.js app loads the scored GeoJSON and paints pins by category.

No database — datasets are GeoJSON and JSON on disk, rebuilt with a CLI and served to the frontend. That keeps the demo fast to clone and easy to inspect.

---

## Tech stack

| Layer | Tools |
|-------|--------|
| **Frontend** | Next.js 16, React 19, Mapbox GL, Tailwind |
| **Backend / data** | Python 3.11+, Shapely, httpx, Playwright (Kijiji) |
| **Routing & map APIs** | OpenRouteService (walk isochrones), Mapbox (tiles + geocoding) |
| **Data sources** | OC Transpo GTFS, OpenStreetMap groceries, City of Ottawa address points |

---

## Quick start

**Requirements:** Node 18+, Python 3.11+, API keys for Mapbox and OpenRouteService.

```bash
# Clone, then:
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -e .
npm install

cp .env.example .env            # ORS_API_KEY, MAPBOX_ACCESS_TOKEN
# .env.local → NEXT_PUBLIC_MAPBOX_TOKEN=<same mapbox token>

python -m padestrian build-essentials
python -m padestrian validate-listings
python -m padestrian build-zones
python -m padestrian filter-listings

npm run dev
```

Open **http://localhost:3000** — the map should load with listings already scored.  
After changing data: `Ctrl+Shift+R` to hard refresh.

First-time grocery refresh (optional):

```bash
python -m padestrian fetch-groceries
python -m padestrian build-essentials
python -m padestrian build-zones
python -m padestrian filter-listings
```

Kijiji import (optional, needs `playwright install chromium`):

```bash
python -m padestrian scrape-listings --pages 3 --max 30 --append
python -m padestrian validate-listings
python -m padestrian filter-listings
```

---

## CLI reference

| Command | What it does |
|---------|----------------|
| `build-essentials` | Export transit stops + grocery points |
| `fetch-groceries` | Pull supermarkets from OpenStreetMap |
| `build-zones` | Generate 10-minute walk polygons |
| `filter-listings` | Score every listing → `listings-scored.geojson` |
| `validate-listings` | Validate catalog + export map layer |
| `seed-listings` | Generate the demo rental set |
| `scrape-listings` | Import ads from Kijiji |
| `prune-kijiji` | Drop listings no longer active on Kijiji |
| `validate-scoring` | Compare scores to a hand-labeled test CSV |
| `check-mapbox` | Sanity-check your Mapbox token |

Full dataset notes: [data/README.md](data/README.md).

---

## Project layout

```text
padestrian/     Python CLI — ingest, zones, scoring, scrape
components/     Map UI (filters, popups, layers)
app/            Next.js entry
data/           Source + generated GeoJSON
public/data/    Served to the browser
public/images/  Map markers + README screenshots
```

---

Built as a portfolio-grade geospatial demo: real APIs, real city open data, and a product story that solves an everyday problem — **where can I rent and still walk to the bus and the store?**
