# Padestrian

**Padestrian** is a map for finding **car-light rentals in Ottawa**.  
Each listing is placed on the map and colored by whether you can walk to groceries and transit within about **10 minutes**.

## What you get

- **Rental pins** on an interactive map, with filters for rent, bedrooms, and walkability
- **Grocery stores** and **transit stops** as map layers
- **Color-coded listings** — walkable (grocery + transit), grocery-only, transit-only, or neither
- **Listing cards** on hover with price, address, and links when available

## Stack

| Part | Role |
|------|------|
| **Next.js + Mapbox** | Web map and UI |
| **Python CLI** | Build datasets, score listings, optional Kijiji import |
| **GeoJSON files** | Map data (no database) |

## Quick start

### 1) Python setup

```bash
python -m venv .venv
.venv\Scripts\activate   # macOS/Linux: source .venv/bin/activate
pip install -e .
```

For Kijiji import only, also run: `playwright install chromium`

### 2) Frontend setup

```bash
npm install
```

### 3) Env setup

Copy `.env.example` to `.env` and set:

- `ORS_API_KEY`
- `MAPBOX_ACCESS_TOKEN`

For the web app, add `.env.local`:

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

Open `http://localhost:3000`. After updating data, hard refresh with `Ctrl+Shift+R`.

## Common workflows

### Refresh groceries and re-score listings

```bash
python -m padestrian fetch-groceries
python -m padestrian build-essentials
python -m padestrian build-zones
python -m padestrian filter-listings
```

### Re-score listings only

```bash
python -m padestrian build-zones
python -m padestrian filter-listings
```

### Add or update Kijiji listings

```bash
python -m padestrian scrape-listings --pages 5 --max 40 --append
python -m padestrian validate-listings
python -m padestrian filter-listings
```

### Remove expired Kijiji listings

```bash
python -m padestrian prune-kijiji --dry-run
python -m padestrian prune-kijiji
python -m padestrian validate-listings
python -m padestrian filter-listings
```

## CLI commands

| Command | Purpose |
|---------|---------|
| `build-essentials` | Export transit stops and grocery locations |
| `fetch-groceries` | Download grocery locations from OpenStreetMap |
| `build-zones` | Build 10-minute walk zones |
| `filter-listings` | Score listings and write the map layer |
| `validate-listings` | Check listings and export GeoJSON |
| `seed-listings` | Generate sample listings |
| `scrape-listings` | Import listings from Kijiji |
| `prune-kijiji` | Remove listings that are no longer on Kijiji |
| `use-listings` | Switch between sample and Kijiji listing sets |
| `validate-scoring` | Compare scores against a labeled test set |
| `import-municipal-addresses` | Import Ottawa address points |
| `fetch-osm-residential` | Download residential addresses from OSM |
| `smoke-isochrone` | Test walking-zone API connectivity |
| `check-mapbox` | Verify Mapbox token |

## Project layout

```text
padestrian/       Python CLI and scoring
components/       Map UI
app/              Next.js app
data/             GeoJSON and source data
public/images/    Map icons
public/data/      Files served to the map
```

More detail on datasets: [data/README.md](data/README.md).
