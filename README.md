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
.venv\Scripts\activate
pip install -e .
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
| `import-municipal-addresses` | Import City of Ottawa address points |
| `fetch-osm-residential` | Cache OSM residential addresses |
| `smoke-isochrone` | Quick ORS test using one stop and one grocery |
| `check-mapbox` | Verify the Mapbox token from `.env` |

## Project layout

```text
padestrian/    Python CLI and scoring code
components/    React map UI
app/           Next.js app entry
data/          GeoJSON, zones, and GTFS input
public/data/   Link to data/ for frontend loading
```

For dataset details and Overpass instructions, see [data/README.md](data/README.md).
