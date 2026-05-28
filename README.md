# Padestrian

Padestrian is an Ottawa rental demo map.
It scores each listing by whether you can walk to:
- a full-size grocery store
- transit

Default scoring uses a 10 minute walking budget.

## Quick start

### 1) Python setup

```bash
python -m venv .venv
.venv\Scripts\activate   # macOS/Linux: source .venv/bin/activate
pip install -e .
playwright install chromium   # required for scrape-listings only
```

### 2) Frontend setup

```bash
npm install
```

### 3) Env setup

Copy `.env.example` to `.env` and set API keys:
- `ORS_API_KEY`
- `MAPBOX_ACCESS_TOKEN`

Also add `.env.local` for Next.js:
- `NEXT_PUBLIC_MAPBOX_TOKEN=<your mapbox token>`

### 4) Build data and score listings

```bash
python -m padestrian fetch-groceries
python -m padestrian build-essentials
python -m padestrian validate-listings
python -m padestrian build-zones
python -m padestrian filter-listings
```

### 5) Start the site

```bash
npm run dev
```

Open `http://localhost:3000` and hard refresh with `Ctrl+Shift+R` after data updates.

## Common workflows

### Refresh grocery data (includes Costco rules)

```bash
python -m padestrian fetch-groceries
python -m padestrian build-essentials
python -m padestrian build-zones
python -m padestrian filter-listings
```

### Re-score without re-fetching groceries

```bash
python -m padestrian build-zones
python -m padestrian filter-listings
```

### Run manual validation report

```bash
python -m padestrian validate-scoring
```

### Kijiji listings (scrape, prune, map)

The map loads **`data/listings-scored.geojson`**, built from **`data/listings.json`**. Use **`--append`** so demo static listings and Kijiji ads can coexist. Sidebar toggles filter by `source` (`kijiji` vs municipal demo).

```bash
# Add new Kijiji ads (skips IDs already in listings.json)
python -m padestrian scrape-listings --pages 5 --max 40 --append

# Preview then remove ads that are no longer ACTIVE on Kijiji
python -m padestrian prune-kijiji --dry-run
python -m padestrian prune-kijiji

# Push changes to the map layer
python -m padestrian validate-listings
python -m padestrian filter-listings
```

**Do not** run `scrape-listings` without `--append` unless you intend to replace the entire catalog with only this run’s scrape.

Snapshots (optional):

```bash
python -m padestrian use-listings --source static
python -m padestrian use-listings --source kijiji
# then validate-listings && filter-listings
```

### Regenerate map pin icons

Colored house pins and the red grocery cart pin are generated from artwork under `scripts/assets/`:

```bash
python scripts/generate_map_icons.py
```

Outputs 64×64 PNGs in `public/images/` (walkable green, grocery-only lime, transit violet, neither slate, default gray; groceries stay red).

## CLI commands

| Command | Purpose |
|---------|---------|
| `build-essentials` | Export GTFS stops and grocery points |
| `fetch-groceries` | Refresh `data/groceries.geojson` from OSM with project filters |
| `build-zones` | Build walk-zone polygons for groceries (and optional transit) |
| `filter-listings` | Score listings into `data/listings-scored.geojson` |
| `validate-scoring` | Compare scored listings to manual CSV labels |
| `validate-listings` | Validate `listings.json` and export `listings.geojson` |
| `seed-listings` | Generate demo listings |
| `scrape-listings` | Scrape Kijiji (Playwright), normalize, dedupe, write `listings.json` |
| `prune-kijiji` | Remove expired Kijiji ads via live page status check |
| `use-listings` | Switch active `listings.json` between static and Kijiji snapshots |
| `import-municipal-addresses` | Import City of Ottawa address points |
| `fetch-osm-residential` | Cache OSM residential addresses |
| `smoke-isochrone` | Quick ORS test using one stop and one grocery |
| `check-mapbox` | Verify the Mapbox token from `.env` |

## Project layout

```text
padestrian/       Python CLI, scoring, scraper, prune-kijiji
components/       React map UI (popups, filters, Mapbox layers)
app/              Next.js app entry + globals.css (popup shells)
data/             GeoJSON, zones, listings JSON, GTFS input
public/images/    Map marker PNGs
public/data/      Junction → data/ for frontend fetches
scripts/          Icon generation (generate_map_icons.py)
```

For dataset details and Overpass instructions, see [data/README.md](data/README.md).
