# Padestrian

A smarter apartment-hunting tool for people who commute on foot—real walking routes to transit and groceries, not crow-fly “Walk Scores.”

## Quick start

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
pip install -e .

cp .env.example .env            # ORS + Mapbox keys
# OC Transpo GTFS → data/GTFSExport/ (see data/README.md)

python -m padestrian build-essentials
python -m padestrian validate-listings   # exports data/listings.geojson
python -m padestrian build-zones         # grocery walk zones (~3 min)
python -m padestrian filter-listings     # score listings → listings-scored.geojson
python -m padestrian serve               # http://127.0.0.1:8765
```

After changing `.env`, restart `serve` and hard-refresh the browser (Ctrl+Shift+R).

## Commands

| Command | Purpose |
|---------|---------|
| `build-essentials` | GTFS → `stops.geojson`, groceries → `groceries-points.geojson` |
| `seed-listings` | Regenerate demo `data/listings.json` (180 Ottawa mocks) |
| `validate-listings` | Check listings JSON → `listings.geojson` for the map |
| `build-zones` | Batch 10‑min walk zones for all groceries (ORS, cached) |
| `filter-listings` | Score listings against zones → `listings-scored.geojson` |
| `smoke-isochrone` | Test 10‑min walk zones for one stop + one grocery |
| `serve` | Local map (Mapbox GL JS) |
| `check-mapbox` | Verify `MAPBOX_ACCESS_TOKEN` in `.env` |

## Map

- **[Mapbox GL JS](https://docs.mapbox.com/mapbox-gl-js/)** v3, style `streets-v12`
- On `serve`, writes `web/config.js` from `.env`; the page sets `mapboxgl.accessToken` from that
- **Basemap test:** http://127.0.0.1:8765/basemap.html
- **Token check:** http://127.0.0.1:8765/config.js (suffix should match terminal)

## Layout

```
padestrian/     Python CLI
web/            Map UI
data/           GeoJSON + GTFS (GTFSExport/ gitignored)
```

## Roadmap

1. Essentials GeoJSON — done  
2. Demo listings on map — done (`listings.json` / `listings.geojson`)  
3. Walking zones — `build-zones` (groceries); smoke test for one stop  
4. Filter listings ∩ walk zones — done (`filter-listings`)  

```bash
# ~129 ORS calls, ~3 min with default delay; resumes from cache if interrupted
python -m padestrian build-zones

# Try first 3 groceries only
python -m padestrian build-zones --grocery-limit 3
```

Data: [data/README.md](data/README.md)
