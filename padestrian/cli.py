import argparse
import sys

from padestrian import __version__
from padestrian.gtfs_stops import export_stops_geojson
from padestrian.groceries import export_grocery_points_geojson
from padestrian.isochrones import run_smoke_isochrone
from padestrian.zones import run_build_zones
from padestrian.filter_listings import score_listings
from padestrian.check_mapbox import check_mapbox_token
from padestrian.listings import (
    ListingValidationError,
    export_listings_geojson,
    validate_catalog,
    write_seed_catalog,
)
from padestrian.serve import DEFAULT_PORT, run_server
from padestrian.paths import (
    GROCERIES_POINTS_PATH,
    GROCERIES_PATH,
    LISTINGS_GEOJSON_PATH,
    LISTINGS_SCORED_PATH,
    STOPS_GEOJSON_PATH,
    STOPS_GTFS_PATH,
)


def _print_stats(label: str, stats: dict[str, int]) -> None:
    print(f"{label}:")
    for key, value in stats.items():
        print(f"  {key}: {value}")


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
    print("View on the map: python -m padestrian serve")
    return 0


def cmd_seed_listings(args: argparse.Namespace) -> int:
    """Generate data/listings.json with demo Ottawa rentals."""
    path = write_seed_catalog(count=args.count)
    print(f"Wrote {path} ({args.count} listings)")
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
    print(f"  eligible (both): {stats.eligible}  ({stats.eligible * 100 // stats.total if stats.total else 0}%)")
    print(f"  grocery zones : {stats.grocery_zone_source}")
    print(f"  transit zones : {stats.transit_zone_source}")
    print(f"\n  -> {LISTINGS_SCORED_PATH}")
    print("\nRestart serve + hard-refresh to see filtered listings on the map.")
    return 0


def cmd_serve(args: argparse.Namespace) -> int:
    """Run local map viewer at http://127.0.0.1:<port>/"""
    run_server(port=args.port, open_browser=not args.no_browser)
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

    serve_parser = subparsers.add_parser(
        "serve",
        help="Local map at http://127.0.0.1:8765 (Mapbox token from .env)",
    )
    serve_parser.add_argument(
        "--port",
        type=int,
        default=DEFAULT_PORT,
        help=f"Port number (default: {DEFAULT_PORT})",
    )
    serve_parser.add_argument(
        "--no-browser",
        action="store_true",
        help="Do not open a browser tab automatically",
    )
    serve_parser.set_defaults(func=cmd_serve)

    check_parser = subparsers.add_parser(
        "check-mapbox",
        help="Verify MAPBOX_ACCESS_TOKEN can load styles/tiles from localhost",
    )
    check_parser.set_defaults(func=lambda _a: check_mapbox_token())

    args = parser.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
