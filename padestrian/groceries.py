import json
from pathlib import Path
from typing import Any

from shapely.geometry import mapping, shape

from padestrian.geojson_io import write_feature_collection
from padestrian.grocery_catalog import feature_tags, should_include_grocery
from padestrian.paths import GROCERIES_PATH, GROCERIES_POINTS_PATH


def _centroid_coordinates(geometry: dict[str, Any]) -> tuple[float, float]:
    """Return (lon, lat) centroid for any GeoJSON geometry."""
    geom = shape(geometry)
    centroid = geom.centroid
    return centroid.x, centroid.y


def _point_coordinates(geometry: dict[str, Any]) -> tuple[float, float]:
    lon, lat = geometry["coordinates"]
    return float(lon), float(lat)


def load_grocery_points(
    groceries_path: Path = GROCERIES_PATH,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """Convert grocery polygons/points into centroid Point features."""
    if not groceries_path.is_file():
        raise FileNotFoundError(f"Groceries GeoJSON not found: {groceries_path}")

    with groceries_path.open(encoding="utf-8") as f:
        source = json.load(f)

    features_out: list[dict[str, Any]] = []
    stats: dict[str, int] = {
        "features_read": 0,
        "from_polygon": 0,
        "from_point": 0,
        "skipped_unknown_geometry": 0,
        "skipped_excluded": 0,
        "features_written": 0,
    }

    for feature in source.get("features", []):
        stats["features_read"] += 1
        geometry = feature.get("geometry")
        if not geometry:
            stats["skipped_unknown_geometry"] += 1
            continue

        geom_type = geometry.get("type")
        props = dict(feature.get("properties") or {})
        if not should_include_grocery(feature_tags(props)):
            stats["skipped_excluded"] += 1
            continue

        if geom_type == "Point":
            lon, lat = _point_coordinates(geometry)
            stats["from_point"] += 1
            source_geometry = "Point"
        elif geom_type in ("Polygon", "MultiPolygon"):
            lon, lat = _centroid_coordinates(geometry)
            stats["from_polygon"] += 1
            source_geometry = geom_type
        else:
            stats["skipped_unknown_geometry"] += 1
            continue

        osm_id = props.pop("@id", None) or feature.get("id")
        name = props.get("name") or props.get("brand")

        features_out.append(
            {
                "type": "Feature",
                "id": osm_id,
                "properties": {
                    "name": name,
                    "shop": props.get("shop"),
                    "brand": props.get("brand"),
                    "osm_id": osm_id,
                    "source_geometry": source_geometry,
                    **{
                        k: v
                        for k, v in props.items()
                        if k not in ("name", "shop", "brand", "type") and not k.startswith("@")
                    },
                },
                "geometry": {
                    "type": "Point",
                    "coordinates": [lon, lat],
                },
            }
        )

    stats["features_written"] = len(features_out)
    return features_out, stats


def export_grocery_points_geojson(
    output_path: Path = GROCERIES_POINTS_PATH,
    groceries_path: Path = GROCERIES_PATH,
) -> dict[str, int]:
    features, stats = load_grocery_points(groceries_path)
    write_feature_collection(
        output_path,
        features,
        metadata={
            "generator": "padestrian",
            "source": "OpenStreetMap groceries.geojson (centroids for isochrones)",
        },
    )
    return stats
