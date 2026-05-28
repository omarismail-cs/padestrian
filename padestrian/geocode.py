"""Forward geocoding via Mapbox (uses MAPBOX_ACCESS_TOKEN from .env)."""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

from padestrian.config import require_env
from padestrian.gtfs_stops import OTTAWA_BBOX

MAPBOX_GEOCODE_URL = "https://api.mapbox.com/geocoding/v5/mapbox.places"


@dataclass(frozen=True)
class GeocodeResult:
    lon: float
    lat: float
    label: str  # Mapbox place_name — use as display address when available


def _in_bbox(lon: float, lat: float) -> bool:
    min_lon, min_lat, max_lon, max_lat = OTTAWA_BBOX
    return min_lon <= lon <= max_lon and min_lat <= lat <= max_lat


_HOUSE_NUMBER_RE = re.compile(r"^(\d+)\s")


def _query_house_number(query: str) -> str | None:
    m = _HOUSE_NUMBER_RE.match(query.strip())
    return m.group(1) if m else None


def _accept_feature(query: str, feat: dict[str, Any]) -> bool:
    """Drop weak street-centroid matches when we asked for a numbered address."""
    relevance = float(feat.get("relevance") or 0)
    if relevance < 0.72:
        return False
    house = _query_house_number(query)
    if not house:
        return True
    label = feat.get("place_name") or feat.get("text") or ""
    if house in label:
        return True
    # Mapbox sometimes omits the number but still has a strong match.
    return relevance >= 0.85


def geocode_address(
    query: str,
    *,
    proximity: tuple[float, float],
    client: httpx.Client | None = None,
) -> GeocodeResult | None:
    """
    Geocode a street address in Ottawa. Returns None if Mapbox has no match in-bbox.
    """
    token = require_env("MAPBOX_ACCESS_TOKEN")
    min_lon, min_lat, max_lon, max_lat = OTTAWA_BBOX
    params = {
        "access_token": token,
        "country": "CA",
        "bbox": f"{min_lon},{min_lat},{max_lon},{max_lat}",
        "proximity": f"{proximity[0]},{proximity[1]}",
        # Mapbox v5 only allows: country, region, place, district, locality,
        # postcode, neighborhood, address (not "street").
        "types": "address",
        "limit": 1,
        "language": "en",
    }
    url = f"{MAPBOX_GEOCODE_URL}/{quote(query, safe='')}.json"

    owns = client is None
    if owns:
        client = httpx.Client(timeout=20.0)
    try:
        resp = client.get(url, params=params)
        resp.raise_for_status()
        data: dict[str, Any] = resp.json()
    except httpx.HTTPError:
        return None
    finally:
        if owns:
            client.close()

    features = data.get("features") or []
    feat = next((f for f in features if _accept_feature(query, f)), None)
    if feat is None:
        return None

    coords = feat.get("geometry", {}).get("coordinates")
    if not coords or len(coords) < 2:
        return None

    lon, lat = float(coords[0]), float(coords[1])
    if not _in_bbox(lon, lat):
        return None

    label = feat.get("place_name") or query
    return GeocodeResult(lon=lon, lat=lat, label=label)
