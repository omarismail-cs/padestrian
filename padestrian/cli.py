import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
import shutil

import httpx
from playwright.sync_api import sync_playwright

from padestrian import __version__
from padestrian.gtfs_stops import export_stops_geojson
from padestrian.groceries import export_grocery_points_geojson
from padestrian.isochrones import run_smoke_isochrone
from padestrian.zones import run_build_zones
from padestrian.filter_listings import score_listings
from padestrian.validate_scoring import print_report, run_validation
from padestrian.check_mapbox import check_mapbox_token
from padestrian.listings import (
    ListingValidationError,
    export_listings_geojson,
    validate_catalog,
    write_seed_catalog,
)
from padestrian.fetch_groceries import export_groceries_geojson
from padestrian.municipal_addresses import import_municipal_geojson
from padestrian.osm_addresses import OSM_RESIDENTIAL_PATH, export_osm_residential_geojson
from padestrian.scraper import (
    extract_kijiji_id,
    normalize_listing,
    scrape_kijiji_urls,
    scrape_listing_detail,
)
from padestrian.paths import (
    GROCERIES_POINTS_PATH,
    GROCERIES_PATH,
    LISTINGS_GEOJSON_PATH,
    LISTINGS_JSON_PATH,
    LISTINGS_SCORED_PATH,
    MUNICIPAL_POINTS_PATH,
    STOPS_GEOJSON_PATH,
    STOPS_GTFS_PATH,
)


def _print_stats(label: str, stats: dict[str, int]) -> None:
    print(f"{label}:")
    for key, value in stats.items():
        print(f"  {key}: {value}")


STATIC_LISTINGS_PATH = LISTINGS_JSON_PATH.with_name("listings.static.json")
KIJIJI_LISTINGS_PATH = LISTINGS_JSON_PATH.with_name("listings.kijiji.json")


def cmd_build_essentials(_args: argparse.Namespace) -> int:
    """Build stops.geojson and groceries-points.geojson from raw data."""
    print(f"GTFS stops: {STOPS_GTFS_PATH}")
    stop_stats = export_stops_geojson()
    _print_stats("Transit stops", stop_stats)
    print(f"  -> {STOPS_GEOJSON_PATH}\n")

    print(f"Groceries: {GROCERIES_PATH}")
    grocery_stats = export_grocery_points_geojson()
    _print_stats("Grocery points", grocery_stats)
    print(f"  -> {GROCERIES_POINTS_PATH}")

    return 0


def cmd_build_zones(args: argparse.Namespace) -> int:
    """Batch ORS walking zones for groceries (and optionally transit)."""
    groceries = not args.no_groceries
    transit = args.transit
    if args.dry_run:
        print("Dry run — no API calls.\n")

    try:
        result = run_build_zones(
            minutes=args.minutes,
            groceries=groceries,
            transit=transit,
            grocery_limit=args.grocery_limit,
            transit_limit=args.transit_limit,
            delay_seconds=args.delay,
            force=args.force,
            dry_run=args.dry_run,
        )
    except (FileNotFoundError, ValueError) as exc:
        print(exc, file=sys.stderr)
        return 1

    print()
    for layer in result.layers:
        print(
            f"{layer.kind}: {layer.total} centers — "
            f"fetched {layer.fetched}, cached {layer.cached}, failed {layer.failed}"
        )
        for err in layer.errors[:5]:
            print(f"  error: {err}")
        if len(layer.errors) > 5:
            print(f"  … and {len(layer.errors) - 5} more errors")

    if result.outputs:
        print("\nWrote:")
        for path in result.outputs:
            print(f"  {path}")
        print("\nNext: filter-listings (coming soon) or view zones on the map.")
    elif not args.dry_run:
        print("\nNo output files (all layers failed or empty).", file=sys.stderr)
        return 1

    return 0 if not any(layer.failed for layer in result.layers) else 1


def cmd_smoke_isochrone(args: argparse.Namespace) -> int:
    """Fetch 10-minute walk zones for one stop and one grocery (ORS API)."""
    if not STOPS_GEOJSON_PATH.is_file() or not GROCERIES_POINTS_PATH.is_file():
        print("Missing stops.geojson or groceries-points.geojson.", file=sys.stderr)
        print("Run: python -m padestrian build-essentials", file=sys.stderr)
        return 1

    print(f"Requesting {args.minutes:g}-minute walking zones from OpenRouteService...")
    output = run_smoke_isochrone(minutes=args.minutes)
    print(f"Wrote {output}")
    print("View on the map: npm run dev  ->  http://localhost:3000")
    return 0


def cmd_fetch_osm_residential(args: argparse.Namespace) -> int:
    """Download OSM buildings with addr tags (cached for seed-listings)."""
    stats = export_osm_residential_geojson(force=args.force)
    print(f"Wrote {OSM_RESIDENTIAL_PATH} ({stats['features_written']} addresses)")
    return 0


def cmd_import_municipal(args: argparse.Namespace) -> int:
    """Import City of Ottawa municipal address CSV → municipal-addresses.geojson."""
    csv_path = args.csv.resolve() if args.csv else None
    print(f"Importing municipal addresses from {csv_path or 'auto-detect'}...")
    try:
        stats = import_municipal_geojson(csv_path=csv_path, force=args.force)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1
    _print_stats("Municipal addresses", stats)
    print(f"  -> {MUNICIPAL_POINTS_PATH}")
    print("\nNext: python -m padestrian seed-listings --source municipal")
    return 0


def _default_seed_source() -> str:
    if MUNICIPAL_POINTS_PATH.is_file():
        return "municipal"
    return "osm"


def cmd_seed_listings(args: argparse.Namespace) -> int:
    """Generate data/listings.json with demo Ottawa rentals."""
    source = args.source or _default_seed_source()
    if args.no_geocode and source in ("osm", "municipal"):
        source = "jitter"
    path = write_seed_catalog(count=args.count, source=source)
    try:
        shutil.copy2(path, STATIC_LISTINGS_PATH)
    except OSError as exc:
        print(f"Warning: failed to snapshot static listings to {STATIC_LISTINGS_PATH}: {exc}", file=sys.stderr)
    print(f"Wrote {path} ({args.count} listings, source={source})")
    print(f"Static snapshot: {STATIC_LISTINGS_PATH}")
    print("Run: python -m padestrian validate-listings")
    return 0


def cmd_validate_listings(_args: argparse.Namespace) -> int:
    """Validate listings.json and export listings.geojson for the map."""
    try:
        _, errors = validate_catalog()
        if errors:
            print("Validation failed:", file=sys.stderr)
            for line in errors[:20]:
                print(f"  {line}", file=sys.stderr)
            if len(errors) > 20:
                print(f"  … and {len(errors) - 20} more", file=sys.stderr)
            return 1
        stats = export_listings_geojson()
    except ListingValidationError as exc:
        print(exc, file=sys.stderr)
        return 1

    print(f"OK: {stats['count']} listings")
    print(f"  Rent: ${stats['rent_min']:,} – ${stats['rent_max']:,} CAD/mo")
    print(f"  -> {LISTINGS_GEOJSON_PATH}")
    return 0


def cmd_filter_listings(args: argparse.Namespace) -> int:
    """Score listings against walk zones and write listings-scored.geojson."""
    try:
        stats = score_listings(minutes=args.minutes)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1

    print(f"Scored {stats.total} listings at {args.minutes:g} min walk:")
    print(f"  near grocery  : {stats.near_grocery}")
    print(f"  near transit  : {stats.near_transit}")
    print(f"    via isochrone: {stats.near_transit_via_zone}")
    print(f"    via nearest stop ({stats.transit_stop_count} stops): {stats.near_transit_via_stop}")
    print(f"  eligible (both): {stats.eligible}  ({stats.eligible * 100 // stats.total if stats.total else 0}%)")
    print(f"  grocery zones : {stats.grocery_zone_source}")
    print(f"  transit zones : {stats.transit_zone_source}")
    print(f"\n  -> {LISTINGS_SCORED_PATH}")
    print("\nHard-refresh http://localhost:3000 to see filtered listings on the map.")
    return 0


def cmd_fetch_groceries(_args: argparse.Namespace) -> int:
    """Refresh data/groceries.geojson from OpenStreetMap (Costco + supermarkets)."""
    try:
        stats = export_groceries_geojson()
    except (RuntimeError, httpx.HTTPError) as exc:
        print(exc, file=sys.stderr)
        return 1

    print(f"Wrote {stats['features_written']} grocery POIs to {GROCERIES_PATH}")
    print(f"  Costco warehouses: {stats['costco_warehouses']}")
    print("Next:")
    print("  python -m padestrian build-essentials")
    print("  python -m padestrian build-zones          # new Costco needs walk polygons")
    print("  python -m padestrian filter-listings")
    return 0


def cmd_validate_scoring(args: argparse.Namespace) -> int:
    """Compare manual validation CSV against listings-scored.geojson."""
    try:
        results, summary = run_validation(csv_path=args.csv or None)
    except FileNotFoundError as exc:
        print(exc, file=sys.stderr)
        return 1
    print_report(results, summary)
    return 0


def cmd_scrape_listings(args: argparse.Namespace) -> int:
    """Scrape Kijiji rentals and write data/listings.json with dedupe options."""
    existing_root: dict[str, object] = {}
    existing_listings: list[dict[str, object]] = []
    if LISTINGS_JSON_PATH.is_file():
        try:
            with LISTINGS_JSON_PATH.open(encoding="utf-8") as f:
                payload = json.load(f)
            if isinstance(payload, dict):
                existing_root = payload
                listings = payload.get("listings")
                if isinstance(listings, list):
                    existing_listings = [x for x in listings if isinstance(x, dict)]
            elif isinstance(payload, list):
                existing_listings = [x for x in payload if isinstance(x, dict)]
        except (OSError, json.JSONDecodeError) as exc:
            print(f"Failed to read {LISTINGS_JSON_PATH}: {exc}", file=sys.stderr)
            return 1

    known_ids = {
        str(row.get("id"))
        for row in existing_listings
        if isinstance(row.get("id"), str) and str(row.get("id")).startswith("kijiji-")
    }

    discovered = scrape_kijiji_urls(args.pages)
    candidates: list[str] = []
    skipped_known = 0
    seen_new_ids: set[str] = set()
    for url in discovered:
        kid = extract_kijiji_id(url)
        if not kid:
            continue
        normalized_id = f"kijiji-{kid}"
        if normalized_id in known_ids:
            skipped_known += 1
            continue
        if normalized_id in seen_new_ids:
            continue
        seen_new_ids.add(normalized_id)
        candidates.append(url)

    scraped_new: list[dict[str, object]] = []
    if candidates and args.max > 0:
        with sync_playwright() as pw:
            browser = pw.chromium.launch(headless=True)
            context = browser.new_context()
            page = context.new_page()
            try:
                for idx, url in enumerate(candidates):
                    raw = scrape_listing_detail(page, url)
                    listing = normalize_listing(raw)
                    if listing is not None:
                        scraped_new.append(listing)
                        if len(scraped_new) >= args.max:
                            break
            finally:
                context.close()
                browser.close()

    if args.append:
        merged = [*existing_listings, *scraped_new]
    else:
        merged = scraped_new

    city = str(existing_root.get("city") or "Ottawa, ON")
    source = str(existing_root.get("source") or "kijiji scrape")
    out_payload = {
        "city": city,
        "source": source,
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "listings": merged,
    }
    try:
        LISTINGS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        with LISTINGS_JSON_PATH.open("w", encoding="utf-8") as f:
            json.dump(out_payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        shutil.copy2(LISTINGS_JSON_PATH, KIJIJI_LISTINGS_PATH)
    except OSError as exc:
        print(f"Failed to write {LISTINGS_JSON_PATH}: {exc}", file=sys.stderr)
        return 1

    print(f"Discovered URLs: {len(discovered)}")
    print(f"Skipped (already known IDs): {skipped_known}")
    print(f"Scraped + normalized new listings: {len(scraped_new)}")
    print(f"Wrote listings: {len(merged)}  -> {LISTINGS_JSON_PATH}")
    print(f"Kijiji snapshot: {KIJIJI_LISTINGS_PATH}")
    return 0


def cmd_use_listings(args: argparse.Namespace) -> int:
    """Switch active data/listings.json between static and kijiji snapshots."""
    src = STATIC_LISTINGS_PATH if args.source == "static" else KIJIJI_LISTINGS_PATH
    if not src.is_file():
        print(f"Missing snapshot: {src}", file=sys.stderr)
        if args.source == "static":
            print("Run: python -m padestrian seed-listings --source municipal", file=sys.stderr)
        else:
            print("Run: python -m padestrian scrape-listings --pages 1 --max 20", file=sys.stderr)
        return 1
    try:
        LISTINGS_JSON_PATH.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(src, LISTINGS_JSON_PATH)
    except OSError as exc:
        print(f"Failed to switch listings: {exc}", file=sys.stderr)
        return 1
    print(f"Active listings set to: {args.source}")
    print(f"  from: {src}")
    print(f"  to  : {LISTINGS_JSON_PATH}")
    print("Next: python -m padestrian validate-listings && python -m padestrian filter-listings")
    return 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        prog="padestrian",
        description="Padestrian — walkable apartment hunting tools",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")

    subparsers = parser.add_subparsers(dest="command", required=True)

    build_parser = subparsers.add_parser(
        "build-essentials",
        help="Export GTFS stops and grocery centroids to GeoJSON",
    )
    build_parser.set_defaults(func=cmd_build_essentials)

    fetch_groceries_parser = subparsers.add_parser(
        "fetch-groceries",
        help="Refresh groceries.geojson from OSM (supermarkets + Costco, filtered)",
    )
    fetch_groceries_parser.set_defaults(func=cmd_fetch_groceries)

    smoke_parser = subparsers.add_parser(
        "smoke-isochrone",
        help="Test ORS walking zones for one stop + one grocery (needs network + .env)",
    )
    smoke_parser.add_argument(
        "--minutes",
        type=float,
        default=10.0,
        help="Walking time limit in minutes (default: 10)",
    )
    smoke_parser.set_defaults(func=cmd_smoke_isochrone)

    zones_parser = subparsers.add_parser(
        "build-zones",
        help="Batch ORS walk zones (default: all groceries; transit optional)",
    )
    zones_parser.add_argument(
        "--minutes",
        type=float,
        default=10.0,
        help="Walking time limit in minutes (default: 10)",
    )
    zones_parser.add_argument(
        "--no-groceries",
        action="store_true",
        help="Skip grocery zones",
    )
    zones_parser.add_argument(
        "--transit",
        action="store_true",
        help="Also build transit stop zones (large — use --transit-limit)",
    )
    zones_parser.add_argument(
        "--grocery-limit",
        type=int,
        default=None,
        metavar="N",
        help="Only process first N groceries (for testing)",
    )
    zones_parser.add_argument(
        "--transit-limit",
        type=int,
        default=None,
        metavar="N",
        help="Only process first N transit stops",
    )
    zones_parser.add_argument(
        "--delay",
        type=float,
        default=1.2,
        help="Seconds between ORS requests (default: 1.2)",
    )
    zones_parser.add_argument(
        "--force",
        action="store_true",
        help="Ignore per-center cache and refetch from ORS",
    )
    zones_parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be fetched without calling ORS",
    )
    zones_parser.set_defaults(func=cmd_build_zones)

    fetch_osm_parser = subparsers.add_parser(
        "fetch-osm-residential",
        help="Cache OSM residential addresses (used by seed-listings)",
    )
    fetch_osm_parser.add_argument(
        "--force",
        action="store_true",
        help="Re-download from Overpass even if cache exists",
    )
    fetch_osm_parser.set_defaults(func=cmd_fetch_osm_residential)

    import_mun_parser = subparsers.add_parser(
        "import-municipal-addresses",
        help="Import Ottawa municipal address CSV (authoritative coords for seed-listings)",
    )
    import_mun_parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Path to Municipal_Address CSV (default: data/ or ~/Downloads)",
    )
    import_mun_parser.add_argument(
        "--force",
        action="store_true",
        help="Rebuild GeoJSON even if cache exists",
    )
    import_mun_parser.set_defaults(func=cmd_import_municipal)

    seed_listings_parser = subparsers.add_parser(
        "seed-listings",
        help="Generate demo data/listings.json (Ottawa mock rentals)",
    )
    seed_listings_parser.add_argument(
        "--count",
        type=int,
        default=180,
        help="Number of listings (default: 180)",
    )
    seed_listings_parser.add_argument(
        "--source",
        choices=("municipal", "osm", "geocode", "jitter"),
        default=None,
        help="municipal=Ottawa address points (default if imported); osm; geocode; jitter",
    )
    seed_listings_parser.add_argument(
        "--no-geocode",
        action="store_true",
        help="Deprecated: same as --source jitter",
    )
    seed_listings_parser.set_defaults(func=cmd_seed_listings)

    validate_listings_parser = subparsers.add_parser(
        "validate-listings",
        help="Validate listings.json and export listings.geojson",
    )
    validate_listings_parser.set_defaults(func=cmd_validate_listings)

    filter_parser = subparsers.add_parser(
        "filter-listings",
        help="Score listings against walk zones → listings-scored.geojson",
    )
    filter_parser.add_argument(
        "--minutes",
        type=float,
        default=10.0,
        help="Walk-time budget to match against zones (default: 10)",
    )
    filter_parser.set_defaults(func=cmd_filter_listings)

    val_score_parser = subparsers.add_parser(
        "validate-scoring",
        help="Compare data/validation_30_filled.csv to listings-scored.geojson",
    )
    val_score_parser.add_argument(
        "--csv",
        type=Path,
        default=None,
        help="Filled validation CSV (default: data/validation_30_filled.csv)",
    )
    val_score_parser.set_defaults(func=cmd_validate_scoring)

    scrape_parser = subparsers.add_parser(
        "scrape-listings",
        help="Scrape Kijiji listings and write data/listings.json",
    )
    scrape_parser.add_argument(
        "--pages",
        type=int,
        default=3,
        help="How many index pages to crawl (default: 3)",
    )
    scrape_parser.add_argument(
        "--max",
        type=int,
        default=60,
        help="Max normalized listings to keep from this run (default: 60)",
    )
    scrape_parser.add_argument(
        "--append",
        action="store_true",
        help="Append to existing listings instead of replacing them",
    )
    scrape_parser.set_defaults(func=cmd_scrape_listings)

    use_parser = subparsers.add_parser(
        "use-listings",
        help="Switch active listings.json between static and kijiji snapshots",
    )
    use_parser.add_argument(
        "--source",
        choices=("static", "kijiji"),
        required=True,
        help="Which snapshot to activate",
    )
    use_parser.set_defaults(func=cmd_use_listings)

    check_parser = subparsers.add_parser(
        "check-mapbox",
        help="Verify MAPBOX_ACCESS_TOKEN can load styles/tiles from localhost",
    )
    check_parser.set_defaults(func=lambda _a: check_mapbox_token())

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
