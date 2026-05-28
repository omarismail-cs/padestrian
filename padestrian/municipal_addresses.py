"""City of Ottawa municipal address points — authoritative coords (like GTFS stops)."""

from __future__ import annotations

import csv
import json
import math
from pathlib import Path
from typing import Any

from padestrian.gtfs_stops import OTTAWA_BBOX, _in_ottawa_bbox
from padestrian.paths import DATA_DIR, MUNICIPAL_POINTS_PATH

# Web Mercator (EPSG:3857) — CSV columns X, Y
_WEB_MERCATOR_R = 20037508.34

DEFAULT_MUNICIPAL_CSV = DATA_DIR / "municipal-addresses.csv"


def _web_mercator_to_wgs84(x: float, y: float) -> tuple[float, float]:
    lon = x * 180 / _WEB_MERCATOR_R
    lat = math.degrees(2 * math.atan(math.exp(y * math.pi / _WEB_MERCATOR_R)) - math.pi / 2)
    return lon, lat


def _format_postal(code: str) -> str:
    code = (code or "").strip().replace(" ", "")
    if len(code) == 6:
        return f"{code[:3]} {code[3:]}"
    return code


def format_municipal_address(row: dict[str, str]) -> str:
    """Human-readable address from municipal CSV row."""
    line = (row.get("FULL_ADDRESS_EN") or "").strip()
    municipality = (row.get("MUNICIPALITY") or row.get("CP_MUNICIPALITY") or "").strip()
    postal = _format_postal(row.get("POSTAL_CODE") or "")
    parts = [line] if line else []
    if municipality:
        parts.append(municipality.title())
    if postal:
        parts.append(f"ON {postal}")
    else:
        parts.append("ON")
    return ", ".join(parts)


def resolve_municipal_csv(path: Path | None = None) -> Path:
    """Find municipal CSV: explicit path, data/, or Downloads."""
    if path is not None:
        p = path.expanduser().resolve()
        if not p.is_file():
            raise FileNotFoundError(f"Municipal CSV not found: {p}")
        return p

    if DEFAULT_MUNICIPAL_CSV.is_file():
        return DEFAULT_MUNICIPAL_CSV

    downloads = Path.home() / "Downloads"
    if downloads.is_dir():
        matches = sorted(downloads.glob("*Municipal*Address*.csv"))
        if matches:
            return matches[0]

    raise FileNotFoundError(
        "Municipal address CSV not found. Pass --csv or place file at "
        f"{DEFAULT_MUNICIPAL_CSV}"
    )


def _row_to_feature(row: dict[str, str]) -> dict[str, Any] | None:
    try:
        x = float(row["X"])
        y = float(row["Y"])
    except (KeyError, TypeError, ValueError):
        return None

    lon, lat = _web_mercator_to_wgs84(x, y)
    if not _in_ottawa_bbox(lon, lat):
        return None

    address = format_municipal_address(row)
    if not address:
        return None

    addr_id = (row.get("MUNICIPAL_ADDRESS_ID") or row.get("OBJECTID") or "").strip()
    municipality = (row.get("MUNICIPALITY") or "").strip()

    return {
        "type": "Feature",
        "id": f"mun-{addr_id}" if addr_id else None,
        "properties": {
            "address": address,
            "municipality": municipality,
            "postal_code": (row.get("POSTAL_CODE") or "").strip(),
            "addr_type": (row.get("ADDRTYPE") or "").strip(),
            "full_address_en": (row.get("FULL_ADDRESS_EN") or "").strip(),
        },
        "geometry": {"type": "Point", "coordinates": [lon, lat]},
    }


def import_municipal_geojson(
    csv_path: Path | None = None,
    output_path: Path = MUNICIPAL_POINTS_PATH,
    *,
    only_main: bool = True,
    force: bool = False,
) -> dict[str, int]:
    """
    Build data/municipal-addresses.geojson from City of Ottawa address points CSV.
    """
    if output_path.is_file() and not force:
        with output_path.open(encoding="utf-8") as f:
            n = len(json.load(f).get("features") or [])
        return {"features_written": n, "cached": 1, "rows_read": 0, "skipped": 0}

    source = resolve_municipal_csv(csv_path)
    stats = {
        "rows_read": 0,
        "skipped": 0,
        "features_written": 0,
        "cached": 0,
    }
    features: list[dict[str, Any]] = []

    with source.open(encoding="utf-8-sig", newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            stats["rows_read"] += 1
            if only_main and (row.get("ADDRTYPE") or "").strip() != "Main":
                stats["skipped"] += 1
                continue
            feat = _row_to_feature(row)
            if feat is None:
                stats["skipped"] += 1
                continue
            features.append(feat)

    stats["features_written"] = len(features)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    collection: dict[str, Any] = {
        "type": "FeatureCollection",
        "generator": "padestrian",
        "source": "City of Ottawa Municipal Address Points",
        "source_csv": str(source),
        "features": features,
    }
    with output_path.open("w", encoding="utf-8") as f:
        json.dump(collection, f, ensure_ascii=False, separators=(",", ":"))

    return stats


def load_municipal_points(
    path: Path = MUNICIPAL_POINTS_PATH,
    *,
    import_if_missing: bool = True,
    csv_path: Path | None = None,
) -> list[dict[str, Any]]:
    if not path.is_file():
        if not import_if_missing:
            raise FileNotFoundError(
                f"Missing {path}. Run: python -m padestrian import-municipal-addresses"
            )
        import_municipal_geojson(csv_path=csv_path)

    with path.open(encoding="utf-8") as f:
        data = json.load(f)
    return [f for f in data.get("features") or [] if f.get("geometry", {}).get("type") == "Point"]
