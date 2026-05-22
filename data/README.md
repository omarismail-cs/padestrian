# Data

Datasets that power **Padestrian**’s walking zones: transit stops from GTFS and grocery locations from OSM. The GTFS export is gitignored (~270 MB); `groceries.geojson` is small enough to commit. See `manifest.json` for sources and snapshot metadata.

## groceries.geojson

Supermarkets and grocery-related places in the Ottawa area, exported from [OpenStreetMap](https://www.openstreetmap.org) via Overpass Turbo.

- **Format:** GeoJSON `FeatureCollection` (129 features: mostly building polygons, some points)
- **License:** [ODbL](https://www.openstreetmap.org/copyright)
- **Refresh:** Re-run your Overpass query for the same bounding box / tags when you need updated POIs

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
