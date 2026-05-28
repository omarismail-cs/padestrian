"""Download grocery POIs from OpenStreetMap Overpass API."""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Any

import httpx

from padestrian.geojson_io import write_feature_collection
from padestrian.grocery_catalog import (
    inclusion_rank,
    is_costco_warehouse,
    should_include_grocery,
)
from padestrian.gtfs_stops import OTTAWA_BBOX, _in_ottawa_bbox
from padestrian.paths import GROCERIES_PATH

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

_OVERPASS_QUERY = """
[out:json][timeout:180];
(
  nwr["shop"="supermarket"]({south},{west},{north},{east});
  nwr["shop"="wholesale"]({south},{west},{north},{east});
);
out center tags;
"""


def _bbox() -> tuple[float, float, float, float]:
    min_lon, min_lat, max_lon, max_lat = OTTAWA_BBOX
    return min_lat, min_lon, max_lat, max_lon


def _element_center(element: dict[str, Any]) -> tuple[float, float] | None:
    center = element.get("center")
    if center and "lon" in center and "lat" in center:
        return float(center["lon"]), float(center["lat"])
    if element.get("type") == "node" and "lon" in element and "lat" in element:
        return float(element["lon"]), float(element["lat"])
    return None


def _element_to_feature(element: dict[str, Any]) -> dict[str, Any] | None:
    tags = dict(element.get("tags") or {})
    if not should_include_grocery(tags):
        return None

    coords = _element_center(element)
    if coords is None:
        return None
    lon, lat = coords
    if not _in_ottawa_bbox(lon, lat):
        return None

    osm_type = element.get("type") or "node"
    osm_id = element.get("id")
    feature_id = f"{osm_type}/{osm_id}" if osm_id is not None else None

    properties: dict[str, Any] = {
        "@id": feature_id,
        **tags,
    }
    if is_costco_warehouse(tags):
        properties.setdefault("shop", "wholesale")
        properties["padestrian_category"] = "costco_warehouse"

    properties = {k: v for k, v in properties.items() if v is not None}

    return {
        "type": "Feature",
        "id": feature_id,
        "properties": properties,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def _dedupe_features(features: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One POI per building cluster (~11 m)."""
    buckets: dict[tuple[int, int], dict[str, Any]] = {}
    for feat in features:
        lon, lat = feat["geometry"]["coordinates"]
        key = (round(lat * 1000), round(lon * 1000))
        tags = feat.get("properties") or {}
        rank = inclusion_rank(tags)
        existing = buckets.get(key)
        if existing is None or rank > inclusion_rank(existing.get("properties") or {}):
            buckets[key] = feat
    return list(buckets.values())


def fetch_grocery_features_from_overpass(*, client: httpx.Client | None = None) -> list[dict[str, Any]]:
    south, west, north, east = _bbox()
    query = _OVERPASS_QUERY.format(south=south, west=west, north=north, east=east)

    owns = client is None
    if owns:
        client = httpx.Client(timeout=200.0)
    try:
        resp = client.post(
            OVERPASS_URL,
            content=query.strip(),
            headers={
                "Content-Type": "text/plain; charset=utf-8",
                "Accept": "*/*",
                "User-Agent": "padestrian/0.1 (grocery Overpass fetch)",
            },
        )
        resp.raise_for_status()
        elements = resp.json().get("elements") or []
    finally:
        if owns:
            client.close()

    raw: list[dict[str, Any]] = []
    for element in elements:
        feat = _element_to_feature(element)
        if feat is not None:
            raw.append(feat)

    return _dedupe_features(raw)


def export_groceries_geojson(output_path: Path = GROCERIES_PATH) -> dict[str, int]:
    """
    Write data/groceries.geojson from Overpass.

    Replaces any prior export (polygon or point). Centroids are used for isochrones.
    """
    features = fetch_grocery_features_from_overpass()
    if not features:
        raise RuntimeError("Overpass returned no grocery features after filtering.")

    meta = {
        "type": "FeatureCollection",
        "generator": "padestrian fetch-groceries",
        "copyright": "OpenStreetMap contributors (ODbL)",
        "timestamp": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "features": features,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    costco = sum(
        1
        for f in features
        if (f.get("properties") or {}).get("padestrian_category") == "costco_warehouse"
        or (f.get("properties") or {}).get("brand", "").lower() == "costco"
    )
    return {
        "features_written": len(features),
        "costco_warehouses": costco,
    }
