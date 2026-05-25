"""
Score listings against walking zones (point-in-polygon via Shapely).

A listing is:
  near_grocery  — its point falls inside at least one grocery-zone polygon
  near_transit  — its point falls inside at least one transit-zone polygon
  eligible      — near_grocery AND near_transit

Zone sources (in priority order):
  1. data/zones/grocery-10min.geojson   (from build-zones)
  2. data/isochrones/smoke.geojson       (smoke fallback — partial coverage)

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
    ZONES_DIR,
    minute_tag,
    zone_merged_path,
)


@dataclass
class FilterStats:
    total: int = 0
    near_grocery: int = 0
    near_transit: int = 0
    eligible: int = 0
    grocery_zone_source: str = "none"
    transit_zone_source: str = "none"


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

    stats = FilterStats(
        grocery_zone_source=grocery_src,
        transit_zone_source=transit_src,
    )

    scored_features: list[dict[str, Any]] = []
    for feature in fc.get("features", []):
        geom = feature.get("geometry")
        if not geom or geom.get("type") != "Point":
            continue

        pt = Point(geom["coordinates"])
        near_g = _point_in_any(pt, grocery_polys)
        near_t = _point_in_any(pt, transit_polys)
        eligible = near_g and near_t

        props = dict(feature.get("properties") or {})
        props["near_grocery"] = near_g
        props["near_transit"] = near_t
        props["eligible"] = eligible
        props["walk_minutes"] = minutes

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
            "total": stats.total,
            "eligible": stats.eligible,
        },
    )
    return stats
