"""
Score listings against walking zones (point-in-polygon via Shapely).

A listing is:
  near_grocery  — inside a grocery ORS isochrone (all groceries are zoned)
  near_transit  — inside a transit ORS isochrone OR within ~10 min walk of a
                  GTFS stop (nearest-stop fallback; full transit zones are optional)
  eligible      — near_grocery AND near_transit

Zone sources (in priority order):
  1. data/zones/grocery-10min.geojson   (from build-zones)
  2. data/isochrones/smoke.geojson       (smoke fallback — partial coverage)

Transit note: `build-zones --transit` often runs with --transit-limit (~200 stops),
so polygon coverage is sparse. Nearest-stop fallback uses all of stops.geojson.

Run:
    python -m padestrian filter-listings
    python -m padestrian filter-listings --minutes 15
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from shapely.geometry import Point, shape

from padestrian.geojson_io import write_feature_collection
from padestrian.paths import (
    LISTINGS_GEOJSON_PATH,
    LISTINGS_SCORED_PATH,
    SMOKE_ISOCHRONE_PATH,
    STOPS_GEOJSON_PATH,
    minute_tag,
    zone_merged_path,
)
from padestrian.transit_proximity import (
    load_stop_coordinates,
    nearest_stop_meters,
    score_near_transit,
    walk_threshold_meters,
)


@dataclass
class FilterStats:
    total: int = 0
    near_grocery: int = 0
    near_transit: int = 0
    eligible: int = 0
    near_transit_via_zone: int = 0
    near_transit_via_stop: int = 0
    grocery_zone_source: str = "none"
    transit_zone_source: str = "none"
    transit_stop_count: int = 0


def _load_polygons(path: Path, roles: set[str]) -> list[Any]:
    """Load Shapely polygon objects from a GeoJSON file, filtered by role property."""
    with path.open(encoding="utf-8") as f:
        fc = json.load(f)
    polys = []
    for feature in fc.get("features", []):
        if feature.get("properties", {}).get("role") not in roles:
            continue
        geom = feature.get("geometry")
        if geom:
            try:
                polys.append(shape(geom))
            except Exception:  # noqa: BLE001
                pass
    return polys


def _point_in_any(point: Point, polygons: list[Any]) -> bool:
    return any(point.within(poly) for poly in polygons)


def _resolve_zone_source(
    kind: str,
    minutes: float,
    *,
    smoke_roles: set[str],
) -> tuple[list[Any], str]:
    """
    Return (polygons, source_label).

    Prefers the merged zone file; falls back to smoke.geojson.
    """
    merged = zone_merged_path(kind, minutes)
    if merged.is_file():
        polys = _load_polygons(merged, {f"{kind}_zone"})
        if polys:
            return polys, merged.name

    # Smoke fallback
    if SMOKE_ISOCHRONE_PATH.is_file():
        polys = _load_polygons(SMOKE_ISOCHRONE_PATH, smoke_roles)
        if polys:
            return polys, f"{SMOKE_ISOCHRONE_PATH.name} (smoke fallback)"

    return [], "none"


def score_listings(
    listings_path: Path = LISTINGS_GEOJSON_PATH,
    output_path: Path = LISTINGS_SCORED_PATH,
    *,
    minutes: float = 10.0,
) -> FilterStats:
    """
    Load listings GeoJSON, score each point against walk zones, write scored GeoJSON.
    """
    if not listings_path.is_file():
        raise FileNotFoundError(
            f"Missing {listings_path}. Run: python -m padestrian validate-listings"
        )

    with listings_path.open(encoding="utf-8") as f:
        fc = json.load(f)

    grocery_polys, grocery_src = _resolve_zone_source(
        "grocery", minutes, smoke_roles={"grocery_zone"}
    )
    transit_polys, transit_src = _resolve_zone_source(
        "transit", minutes, smoke_roles={"transit_zone"}
    )
    stops = load_stop_coordinates(STOPS_GEOJSON_PATH)

    stats = FilterStats(
        grocery_zone_source=grocery_src,
        transit_zone_source=transit_src,
        transit_stop_count=len(stops),
    )

    scored_features: list[dict[str, Any]] = []
    for feature in fc.get("features", []):
        geom = feature.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue

        lon, lat = geom["coordinates"]
        pt = Point(lon, lat)
        near_g = _point_in_any(pt, grocery_polys)
        in_zone = _point_in_any(pt, transit_polys)
        near_t, transit_via = score_near_transit(
            lon,
            lat,
            in_transit_zone=in_zone,
            stops=stops,
            minutes=minutes,
        )
        eligible = near_g and near_t

        props = dict(feature.get("properties") or {})
        props["near_grocery"] = near_g
        props["near_transit"] = near_t
        props["eligible"] = eligible
        props["walk_minutes"] = minutes
        props["transit_via"] = transit_via
        stop_dist = nearest_stop_meters(lon, lat, stops)
        if stop_dist is not None:
            props["nearest_stop_m"] = round(stop_dist)

        scored_features.append(
            {
                "type": "Feature",
                "id": feature.get("id"),
                "properties": props,
                "geometry": geom,
            }
        )

        stats.total += 1
        if near_g:
            stats.near_grocery += 1
        if near_t:
            stats.near_transit += 1
            if transit_via == "zone":
                stats.near_transit_via_zone += 1
            elif transit_via == "nearest_stop":
                stats.near_transit_via_stop += 1
        if eligible:
            stats.eligible += 1

    write_feature_collection(
        output_path,
        scored_features,
        metadata={
            "generator": "padestrian filter-listings",
            "walk_minutes": minutes,
            "grocery_zone_source": grocery_src,
            "transit_zone_source": transit_src,
            "transit_stop_count": stats.transit_stop_count,
            "transit_walk_threshold_m": round(walk_threshold_meters(minutes)),
            "near_transit_via_zone": stats.near_transit_via_zone,
            "near_transit_via_stop": stats.near_transit_via_stop,
            "total": stats.total,
            "eligible": stats.eligible,
        },
    )
    return stats
