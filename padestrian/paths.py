from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "data"
PUBLIC_DATA_DIR = PROJECT_ROOT / "public" / "data"
GTFS_DIR = DATA_DIR / "GTFSExport"

GROCERIES_PATH = DATA_DIR / "groceries.geojson"
GROCERIES_POINTS_PATH = PUBLIC_DATA_DIR / "groceries-points.geojson"
STOPS_GTFS_PATH = GTFS_DIR / "stops.txt"
STOPS_GEOJSON_PATH = PUBLIC_DATA_DIR / "stops.geojson"
ISOCHRONES_DIR = DATA_DIR / "isochrones"
SMOKE_ISOCHRONE_PATH = ISOCHRONES_DIR / "smoke.geojson"
LISTINGS_JSON_PATH = DATA_DIR / "listings.json"
LISTINGS_GEOJSON_PATH = DATA_DIR / "listings.geojson"
LISTINGS_SCORED_PATH = DATA_DIR / "listings-scored.geojson"
MUNICIPAL_POINTS_PATH = DATA_DIR / "municipal-addresses.geojson"
ZONES_DIR = DATA_DIR / "zones"
ZONES_CACHE_DIR = ZONES_DIR / "cache"
TRANSIT_HUBS_GEOJSON_PATH = DATA_DIR / "transit-hubs.geojson"


def minute_tag(minutes: float) -> str:
    """Filesystem-safe string for a walk-time budget, e.g. 10 → '10min', 7.5 → '7p5min'."""
    if minutes == int(minutes):
        return f"{int(minutes)}min"
    return f"{minutes:g}min".replace(".", "p")


def zone_merged_path(kind: str, minutes: float) -> Path:
    """Merged zone layer, e.g. data/zones/grocery-10min.geojson."""
    return ZONES_DIR / f"{kind}-{minute_tag(minutes)}.geojson"
