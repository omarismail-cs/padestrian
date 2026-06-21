"""Transit walkability — zone polygons plus nearest-stop fallback."""

from __future__ import annotations

import json
import math
from pathlib import Path

from padestrian.paths import STOPS_GEOJSON_PATH

# Urban walking ~5 km/h with typical street-grid detour vs straight line.
_METERS_PER_MINUTE = 5000.0 / 60.0
_DETOUR_FACTOR = 1.35


def walk_threshold_meters(minutes: float) -> float:
    """Crow-flies distance that usually fits within `minutes` of walking."""
    return minutes * _METERS_PER_MINUTE * _DETOUR_FACTOR


def haversine_meters(lon1: float, lat1: float, lon2: float, lat2: float) -> float:
    r = 6_371_000.0
    p = math.pi / 180.0
    dlat = (lat2 - lat1) * p
    dlon = (lon2 - lon1) * p
    a = (
        math.sin(dlat / 2) ** 2
        + math.cos(lat1 * p) * math.cos(lat2 * p) * math.sin(dlon / 2) ** 2
    )
    return 2 * r * math.asin(math.sqrt(a))


def load_stop_coordinates(path: Path = STOPS_GEOJSON_PATH) -> list[tuple[float, float]]:
    if not path.is_file():
        return []
    with path.open(encoding="utf-8") as f:
        fc = json.load(f)
    coords: list[tuple[float, float]] = []
    for feat in fc.get("features") or []:
        geom = feat.get("geometry") or {}
        if geom.get("type") != "Point":
            continue
        c = geom.get("coordinates")
        if c and len(c) >= 2:
            coords.append((float(c[0]), float(c[1])))
    return coords


def nearest_stop_meters(
    lon: float,
    lat: float,
    stops: list[tuple[float, float]],
) -> float | None:
    if not stops:
        return None
    return min(haversine_meters(lon, lat, slon, slat) for slon, slat in stops)


def score_near_transit(
    lon: float,
    lat: float,
    *,
    in_transit_zone: bool,
    stops: list[tuple[float, float]],
    minutes: float,
) -> tuple[bool, str]:
    """
    Return (near_transit, method).

    method is 'zone' (ORS isochrone polygon), 'nearest_stop' (GTFS + walk threshold),
    or 'none'.
    """
    if in_transit_zone:
        return True, "zone"

    threshold = walk_threshold_meters(minutes)
    dist = nearest_stop_meters(lon, lat, stops)
    if dist is not None and dist <= threshold:
        return True, "nearest_stop"

    return False, "none"
