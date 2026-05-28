"""Static rental listings — validate JSON and export GeoJSON for the map."""

from __future__ import annotations

import json
import random
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx

from padestrian.geocode import geocode_address
from padestrian.geojson_io import write_feature_collection
from padestrian.municipal_addresses import load_municipal_points
from padestrian.osm_addresses import load_residential_points
from padestrian.gtfs_stops import OTTAWA_BBOX, _in_ottawa_bbox as _in_bbox
from padestrian.paths import LISTINGS_GEOJSON_PATH, LISTINGS_JSON_PATH

REQUIRED_FIELDS = ("id", "address", "lat", "lon", "rent_cad", "bedrooms")


class ListingValidationError(Exception):
    """Raised when listings.json fails validation."""


def _load_catalog(path: Path = LISTINGS_JSON_PATH) -> dict[str, Any]:
    if not path.is_file():
        raise ListingValidationError(f"Missing {path}")
    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ListingValidationError("Root must be a JSON object")
    listings = data.get("listings")
    if not isinstance(listings, list):
        raise ListingValidationError("Expected a 'listings' array")
    return data


def validate_listing(row: dict[str, Any], index: int) -> list[str]:
    errors: list[str] = []
    prefix = f"listings[{index}]"

    for field in REQUIRED_FIELDS:
        if field not in row or row[field] is None or row[field] == "":
            errors.append(f"{prefix}: missing '{field}'")

    listing_id = row.get("id")
    if listing_id is not None and not isinstance(listing_id, str):
        errors.append(f"{prefix}: id must be a string")

    try:
        lat = float(row["lat"])
        lon = float(row["lon"])
    except (KeyError, TypeError, ValueError):
        errors.append(f"{prefix}: lat/lon must be numbers")
        return errors

    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        errors.append(f"{prefix}: lat/lon out of range")
    elif not _in_bbox(lon, lat):
        errors.append(f"{prefix}: coordinates outside Ottawa bbox {OTTAWA_BBOX}")

    try:
        rent = float(row["rent_cad"])
        if rent <= 0:
            errors.append(f"{prefix}: rent_cad must be positive")
    except (KeyError, TypeError, ValueError):
        errors.append(f"{prefix}: rent_cad must be a number")

    try:
        beds = int(row["bedrooms"])
        if beds < 0 or beds > 10:
            errors.append(f"{prefix}: bedrooms must be 0–10")
    except (KeyError, TypeError, ValueError):
        errors.append(f"{prefix}: bedrooms must be an integer")

    baths = row.get("bathrooms")
    if baths is not None:
        try:
            b = float(baths)
            if b <= 0 or b > 10:
                errors.append(f"{prefix}: bathrooms out of range")
        except (TypeError, ValueError):
            errors.append(f"{prefix}: bathrooms must be a number")

    return errors


def validate_catalog(path: Path = LISTINGS_JSON_PATH) -> tuple[dict[str, Any], list[str]]:
    data = _load_catalog(path)
    listings = data["listings"]
    errors: list[str] = []
    seen_ids: set[str] = set()

    for i, row in enumerate(listings):
        if not isinstance(row, dict):
            errors.append(f"listings[{i}]: must be an object")
            continue
        errors.extend(validate_listing(row, i))
        lid = row.get("id")
        if isinstance(lid, str):
            if lid in seen_ids:
                errors.append(f"listings[{i}]: duplicate id '{lid}'")
            seen_ids.add(lid)

    return data, errors


def listing_to_feature(row: dict[str, Any]) -> dict[str, Any]:
    props = {
        "id": row["id"],
        "title": row.get("title") or row["address"],
        "address": row["address"],
        "rent_cad": int(row["rent_cad"]) if float(row["rent_cad"]).is_integer() else float(row["rent_cad"]),
        "bedrooms": int(row["bedrooms"]),
        "neighborhood": row.get("neighborhood") or "",
        "source": row.get("source") or "demo",
    }
    if row.get("bathrooms") is not None:
        props["bathrooms"] = float(row["bathrooms"])
    if row.get("url"):
        props["url"] = row["url"]

    lon, lat = float(row["lon"]), float(row["lat"])
    return {
        "type": "Feature",
        "id": row["id"],
        "properties": props,
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def export_listings_geojson(
    path: Path = LISTINGS_JSON_PATH,
    output: Path = LISTINGS_GEOJSON_PATH,
) -> dict[str, int]:
    data, errors = validate_catalog(path)
    if errors:
        raise ListingValidationError("\n".join(errors))

    features = [listing_to_feature(row) for row in data["listings"]]
    write_feature_collection(
        output,
        features,
        metadata={
            "city": data.get("city", "Ottawa, ON"),
            "source": data.get("source", "demo"),
            "listingCount": len(features),
        },
    )
    rents = [f["properties"]["rent_cad"] for f in features]
    return {
        "count": len(features),
        "rent_min": int(min(rents)),
        "rent_max": int(max(rents)),
    }


# Demo seed — neighborhood center (lon, lat) + streets that actually exist in that area.
_DEMO_NEIGHBORHOODS: list[tuple[str, float, float, list[str]]] = [
    (
        "ByWard Market",
        -75.692,
        45.428,
        ["Murray St", "York St", "Sussex Dr", "George St", "William St", "Rideau St"],
    ),
    (
        "Centretown",
        -75.698,
        45.421,
        ["Cooper St", "Lisgar St", "Gilmour St", "O'Connor St", "Metcalfe St", "Kent St", "Laurier Ave W"],
    ),
    (
        "Glebe",
        -75.689,
        45.398,
        ["Bank St", "Powell Ave", "Fourth Ave", "Fifth Ave", "Lyon St S", "O'Connor St"],
    ),
    (
        "Sandy Hill",
        -75.675,
        45.424,
        ["King Edward Ave", "Stewart St", "Russell Ave", "Templeton St", "Nelson St"],
    ),
    (
        "Lowertown",
        -75.685,
        45.435,
        ["King Edward Ave", "Beausoleil Dr", "Cobourg St", "Guigues Ave", "Wurtemburg St"],
    ),
    (
        "Hintonburg",
        -75.725,
        45.403,
        ["Wellington St W", "Armstrong St", "Pinhey St", "Spadina Ave", "Parkdale Ave"],
    ),
    (
        "Westboro",
        -75.752,
        45.392,
        ["Richmond Rd", "Byron Ave", "Dovercourt Ave", "Golden Ave", "Tweedsmuir Ave"],
    ),
    (
        "Little Italy",
        -75.712,
        45.409,
        ["Preston St", "Rochester St", "Beech St", "Booth St", "Bell St N"],
    ),
    (
        "Vanier",
        -75.665,
        45.432,
        ["Montreal Rd", "Vanier Pkwy", "Marier Ave", "Cummings Ave", "Père Blanc Ave"],
    ),
    (
        "Alta Vista",
        -75.662,
        45.385,
        ["Alta Vista Dr", "Riverside Dr", "Smyth Rd", "Coronation Ave", "Dauphin St"],
    ),
    (
        "Billings Bridge",
        -75.655,
        45.375,
        ["Bank St", "Heron Rd", "Riverside Dr", "Bronson Ave", "Walkley Rd"],
    ),
    (
        "Orleans",
        -75.510,
        45.470,
        ["St Joseph Blvd", "Jeanne d'Arc Blvd", "Orleans Blvd", "Tenth Line Rd", "Innes Rd"],
    ),
    (
        "Kanata",
        -75.900,
        45.308,
        ["Castlefrank Rd", "Terry Fox Dr", "Eagleson Rd", "Huntmar Dr", "Goulbourn St"],
    ),
    (
        "Barrhaven",
        -75.735,
        45.278,
        ["Greenbank Rd", "Strandherd Dr", "Woodroffe Ave", "Jockvale Rd", "Prince of Wales Dr"],
    ),
    (
        "Nepean",
        -75.760,
        45.348,
        ["Merivale Rd", "Clyde Ave", "Colonnade Rd", "Viewmount Dr", "Centrepointe Dr"],
    ),
    (
        "Stittsville",
        -75.920,
        45.258,
        ["Stittsville Main St", "Hazeldean Rd", "Carp Rd", "Abbott St", "Granada Cres"],
    ),
    (
        "Rockcliffe",
        -75.655,
        45.448,
        ["Acacia Ave", "Springfield Rd", "Buena Vista Rd", "Lansdowne Rd", "McKay Lake Rd"],
    ),
    (
        "New Edinburgh",
        -75.680,
        45.445,
        ["Beechwood Ave", "Stanley Ave", "Crichton St", "MacKay St", "Dufferin Rd"],
    ),
]


def _nearest_neighborhood(lon: float, lat: float) -> str:
    best = _DEMO_NEIGHBORHOODS[0][0]
    best_d = float("inf")
    for hood, hood_lon, hood_lat, _ in _DEMO_NEIGHBORHOODS:
        d = (lon - hood_lon) ** 2 + (lat - hood_lat) ** 2
        if d < best_d:
            best_d = d
            best = hood
    return best


def _demo_rent_and_title(rng: random.Random, bedrooms: int) -> tuple[int, str]:
    if bedrooms == 0:
        return rng.randint(1150, 1750), "Studio apartment"
    if bedrooms == 1:
        return rng.randint(1450, 2200), "1 bedroom"
    if bedrooms == 2:
        return rng.randint(1750, 2850), "2 bedroom"
    return rng.randint(2200, 3400), "3 bedroom"


def seed_demo_listings(
    count: int = 180,
    *,
    seed: int = 42,
    source: str = "osm",
) -> dict[str, Any]:
    """
    Build a reproducible demo catalog for Ottawa.

    source:
      municipal — City of Ottawa address points CSV (authoritative lat/lon)
      osm — OpenStreetMap building coordinates + addr tags
      geocode — invented addresses forwarded through Mapbox
      jitter — random offsets around neighborhood centers (legacy)
    """
    if source == "municipal":
        return _seed_from_municipal(count, seed=seed)
    if source == "osm":
        return _seed_from_osm(count, seed=seed)
    if source == "geocode":
        return _seed_from_geocode(count, seed=seed)
    if source == "jitter":
        return _seed_from_jitter(count, seed=seed)
    raise ValueError(f"Unknown seed source {source!r}; use municipal, osm, geocode, or jitter")


def _seed_from_municipal(count: int, *, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    pool = load_municipal_points()
    if len(pool) < count:
        raise RuntimeError(
            f"Only {len(pool)} municipal addresses available; need {count}. "
            "Run: python -m padestrian import-municipal-addresses"
        )

    picks = rng.sample(pool, count)
    listings: list[dict[str, Any]] = []
    for i, feat in enumerate(picks):
        lon, lat = feat["geometry"]["coordinates"]
        props = feat.get("properties") or {}
        address = props.get("address") or ""
        hood = (props.get("municipality") or "").strip() or _nearest_neighborhood(lon, lat)
        if hood:
            hood = hood.title()
        bedrooms = rng.choices([0, 1, 2, 3], weights=[12, 38, 35, 15])[0]
        bathrooms = 1.0 if bedrooms <= 1 else (1.5 if bedrooms == 2 else 2.0)
        base_rent, title = _demo_rent_and_title(rng, bedrooms)
        listings.append(
            {
                "id": f"ott-{i + 1:04d}",
                "title": f"{title} — {hood}",
                "address": address,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "rent_cad": base_rent,
                "bedrooms": bedrooms,
                "bathrooms": bathrooms,
                "neighborhood": hood,
                "source": "padestrian-demo-municipal",
                "url": f"https://example.com/listings/ott-{i + 1:04d}",
            }
        )

    return {
        "city": "Ottawa, ON",
        "source": "padestrian demo seed (City of Ottawa municipal address points)",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "listings": listings,
    }


def _seed_from_osm(count: int, *, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    pool = load_residential_points()
    if len(pool) < count:
        raise RuntimeError(
            f"Only {len(pool)} OSM residential addresses available; need {count}. "
            "Re-run fetch-osm-residential or lower --count."
        )

    picks = rng.sample(pool, count)
    listings: list[dict[str, Any]] = []
    for i, feat in enumerate(picks):
        lon, lat = feat["geometry"]["coordinates"]
        props = feat.get("properties") or {}
        address = props.get("address") or ""
        hood = _nearest_neighborhood(lon, lat)
        bedrooms = rng.choices([0, 1, 2, 3], weights=[12, 38, 35, 15])[0]
        bathrooms = 1.0 if bedrooms <= 1 else (1.5 if bedrooms == 2 else 2.0)
        base_rent, title = _demo_rent_and_title(rng, bedrooms)
        listings.append(
            {
                "id": f"ott-{i + 1:04d}",
                "title": f"{title} — {hood}",
                "address": address,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "rent_cad": base_rent,
                "bedrooms": bedrooms,
                "bathrooms": bathrooms,
                "neighborhood": hood,
                "source": "padestrian-demo-osm",
                "url": f"https://example.com/listings/ott-{i + 1:04d}",
            }
        )

    return {
        "city": "Ottawa, ON",
        "source": "padestrian demo seed (OSM building coordinates + addr tags)",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "listings": listings,
    }


def _seed_from_geocode(count: int, *, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    listings: list[dict[str, Any]] = []
    attempts = 0
    max_attempts = count * 8
    client = httpx.Client(timeout=20.0)

    try:
        while len(listings) < count and attempts < max_attempts:
            attempts += 1
            hood, base_lon, base_lat, streets = rng.choice(_DEMO_NEIGHBORHOODS)
            bedrooms = rng.choices([0, 1, 2, 3], weights=[12, 38, 35, 15])[0]
            bathrooms = 1.0 if bedrooms <= 1 else (1.5 if bedrooms == 2 else 2.0)
            base_rent, title = _demo_rent_and_title(rng, bedrooms)
            street = rng.choice(streets)
            number = rng.randint(12, 999)
            query = f"{number} {street}, {hood}, Ottawa, ON"
            hit = geocode_address(query, proximity=(base_lon, base_lat), client=client)
            if hit is None:
                time.sleep(0.05)
                continue
            lon, lat, address = hit.lon, hit.lat, hit.label
            time.sleep(0.05)
            i = len(listings)
            listings.append(
                {
                    "id": f"ott-{i + 1:04d}",
                    "title": f"{title} — {hood}",
                    "address": address,
                    "lat": round(lat, 6),
                    "lon": round(lon, 6),
                    "rent_cad": base_rent,
                    "bedrooms": bedrooms,
                    "bathrooms": bathrooms,
                    "neighborhood": hood,
                    "source": "padestrian-demo",
                    "url": f"https://example.com/listings/ott-{i + 1:04d}",
                }
            )
    finally:
        client.close()

    if len(listings) < count:
        raise RuntimeError(
            f"Only geocoded {len(listings)}/{count} listings after {attempts} attempts. "
            "Check MAPBOX_ACCESS_TOKEN or use --source osm."
        )

    return {
        "city": "Ottawa, ON",
        "source": "padestrian demo seed (Mapbox-geocoded addresses)",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "listings": listings,
    }


def _seed_from_jitter(count: int, *, seed: int) -> dict[str, Any]:
    rng = random.Random(seed)
    listings: list[dict[str, Any]] = []
    for i in range(count):
        hood, base_lon, base_lat, streets = rng.choice(_DEMO_NEIGHBORHOODS)
        bedrooms = rng.choices([0, 1, 2, 3], weights=[12, 38, 35, 15])[0]
        bathrooms = 1.0 if bedrooms <= 1 else (1.5 if bedrooms == 2 else 2.0)
        base_rent, title = _demo_rent_and_title(rng, bedrooms)
        street = rng.choice(streets)
        number = rng.randint(12, 999)
        address = f"{number} {street}, {hood}, Ottawa, ON"
        lon = base_lon + rng.uniform(-0.018, 0.018)
        lat = base_lat + rng.uniform(-0.012, 0.012)
        lon = max(OTTAWA_BBOX[0], min(OTTAWA_BBOX[2], lon))
        lat = max(OTTAWA_BBOX[1], min(OTTAWA_BBOX[3], lat))
        listings.append(
            {
                "id": f"ott-{i + 1:04d}",
                "title": f"{title} — {hood}",
                "address": address,
                "lat": round(lat, 6),
                "lon": round(lon, 6),
                "rent_cad": base_rent,
                "bedrooms": bedrooms,
                "bathrooms": bathrooms,
                "neighborhood": hood,
                "source": "padestrian-demo",
                "url": f"https://example.com/listings/ott-{i + 1:04d}",
            }
        )

    return {
        "city": "Ottawa, ON",
        "source": "padestrian demo seed (random jitter, not geocoded)",
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "listings": listings,
    }


def write_seed_catalog(
    path: Path = LISTINGS_JSON_PATH,
    count: int = 180,
    *,
    source: str = "osm",
) -> Path:
    catalog = seed_demo_listings(count, source=source)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write("\n")
    return path
