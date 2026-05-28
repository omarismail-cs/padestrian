"""Residential addresses from OpenStreetMap — same idea as GTFS stop_lat/lon."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any
import httpx

from padestrian.geojson_io import write_feature_collection
from padestrian.gtfs_stops import OTTAWA_BBOX, _in_ottawa_bbox
from padestrian.paths import DATA_DIR

OSM_RESIDENTIAL_PATH = DATA_DIR / "osm-residential.geojson"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Buildings with street numbers in the Ottawa bbox (same bounds as transit/grocery checks).
_OVERPASS_QUERY = """
[out:json][timeout:120];
(
  way["building"]["addr:housenumber"]["addr:street"]({south},{west},{north},{east});
  node["building"]["addr:housenumber"]["addr:street"]({south},{west},{north},{east});
);
out center;
"""


def _bbox_overpass() -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = OTTAWA_BBOX
    return min_lat, min_lon, max_lat, max_lon


def _format_address(tags: dict[str, Any]) -> str | None:
    number = (tags.get("addr:housenumber") or "").strip()
    street = (tags.get("addr:street") or "").strip()
    if not number or not street:
        return None
    city = (tags.get("addr:city") or tags.get("addr:suburb") or "Ottawa").strip()
    province = (tags.get("addr:province") or "ON").strip()
    postcode = (tags.get("addr:postcode") or "").strip()
    line = ", ".join([f"{number} {street}", city, province])
    if postcode:
        line = f"{line} {postcode}"
    return line


def _element_coordinates(el: dict[str, Any]) -> tuple[float, float] | None:
    if el.get("type") == "node":
        try:
            return float(el["lon"]), float(el["lat"])
        except (KeyError, TypeError, ValueError):
            return None
    center = el.get("center")
    if center:
        try:
            return float(center["lon"]), float(center["lat"])
        except (KeyError, TypeError, ValueError):
            return None
    return None


def _overpass_elements_to_features(elements: list[dict[str, Any]]) -> list[dict[str, Any]]:
    features: list[dict[str, Any]] = []
    for el in elements:
        tags = el.get("tags") or {}
        address = _format_address(tags)
        if not address:
            continue
        coords = _element_coordinates(el)
        if coords is None:
            continue
        lon, lat = coords
        if not _in_ottawa_bbox(lon, lat):
            continue
        osm_id = f"{el.get('type')}/{el.get('id')}"
        features.append(
            {
                "type": "Feature",
                "id": osm_id,
                "properties": {
                    "osm_id": osm_id,
                    "address": address,
                    "addr_street": tags.get("addr:street"),
                    "addr_city": tags.get("addr:city") or tags.get("addr:suburb"),
                },
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
            }
        )
    return features


def fetch_residential_from_overpass(*, client: httpx.Client | None = None) -> list[dict[str, Any]]:
    """Download OSM buildings with addr tags; return GeoJSON Point features."""
    south, west, north, east = _bbox_overpass()
    query = _OVERPASS_QUERY.format(south=south, west=west, north=north, east=east)

    owns = client is None
    if owns:
        client = httpx.Client(timeout=180.0)
    try:
        resp = client.post(
            OVERPASS_URL,
            content=query.strip(),
            headers={
                "Content-Type": "text/plain; charset=utf-8",
                "Accept": "*/*",
                "User-Agent": "padestrian/0.1 (OSM residential seed)",
            },
        )
        resp.raise_for_status()
        payload = resp.json()
    finally:
        if owns:
            client.close()

    elements = payload.get("elements") or []
    return _overpass_elements_to_features(elements)


def load_residential_points(
    path: Path = OSM_RESIDENTIAL_PATH,
    *,
    fetch_if_missing: bool = True,
) -> list[dict[str, Any]]:
    """Load cached OSM residential points, optionally fetching from Overpass first."""
    if not path.is_file():
        if not fetch_if_missing:
            raise FileNotFoundError(
                f"Missing {path}. Run: python -m padestrian fetch-osm-residential"
            )
        features = fetch_residential_from_overpass()
        if not features:
            raise RuntimeError("Overpass returned no residential addresses in Ottawa bbox.")
        write_feature_collection(
            path,
            features,
            metadata={
                "generator": "padestrian",
                "source": "OpenStreetMap Overpass (building + addr:housenumber + addr:street)",
            },
        )
        time.sleep(0.5)
    else:
        with path.open(encoding="utf-8") as f:
            data = json.load(f)
        features = data.get("features") or []

    return [f for f in features if f.get("geometry", {}).get("type") == "Point"]


def export_osm_residential_geojson(
    output_path: Path = OSM_RESIDENTIAL_PATH,
    *,
    force: bool = False,
) -> dict[str, int]:
    if output_path.is_file() and not force:
        with output_path.open(encoding="utf-8") as f:
            n = len(json.load(f).get("features") or [])
        return {"features_written": n, "cached": 1}

    features = fetch_residential_from_overpass()
    write_feature_collection(
        output_path,
        features,
        metadata={
            "generator": "padestrian",
            "source": "OpenStreetMap Overpass (building + addr:housenumber + addr:street)",
        },
    )
    return {"features_written": len(features), "cached": 0}
