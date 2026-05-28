"""Which OSM grocery POIs count as full-size weekly shopping."""

from __future__ import annotations

from typing import Any

# Not a full weekly shop for most households.
EXCLUDED_BRANDS: frozenset[str] = frozenset(
    {
        "bulk barn",
    }
)

# Mis-tagged or specialty / spice / market — not main grocery runs.
EXCLUDED_NAME_SUBSTRINGS: tuple[str, ...] = (
    "bulk barn",
    "crusader concrete",
    "terra flowers",
    "zero waste",
    "natural food pantry",
    "spice world",
    "bombay spices",
    "silk road foods",
    "africa world market",
    "ottawa street markets",
    "farmer's pick",
    "cedars & co",
    "geeland international",
    "kowloon",
    "sultan supermarket",
    "sultan super",
    "mid-east foods",
    "mid east foods",
)

# Costco campus amenities (keep the warehouse only).
_COSTCO_AMENITY_SUBSTRINGS: tuple[str, ...] = (
    "pharmacy",
    "pharmacie",
    "gasoline",
    "gas ",
    "tire",
    "pneu",
    "food court",
    "restauration",
    "aire de",
)


def _norm(s: str | None) -> str:
    return (s or "").strip().lower()


def is_costco_warehouse(tags: dict[str, Any]) -> bool:
    """Main Costco warehouse / business center, not gas or pharmacy."""
    brand = _norm(str(tags.get("brand") or ""))
    name = _norm(str(tags.get("name") or ""))
    shop = _norm(str(tags.get("shop") or ""))

    if brand != "costco" and "costco" not in name:
        return False
    if any(sub in name for sub in _COSTCO_AMENITY_SUBSTRINGS):
        return False
    if shop == "wholesale" or name in ("costco", "costco business center"):
        return True
    if name.startswith("costco") and shop in ("wholesale", "department_store", ""):
        return True
    return False


def should_include_grocery(tags: dict[str, Any]) -> bool:
    """
  Include full-size grocery POIs for walk scoring.

  - shop=supermarket (default OSM export)
  - Costco warehouses (shop=wholesale), not gas/pharmacy satellites
  """
    if not tags:
        return False

    brand = _norm(str(tags.get("brand") or ""))
    name = _norm(str(tags.get("name") or ""))
    shop = _norm(str(tags.get("shop") or ""))

    if brand in EXCLUDED_BRANDS or any(sub in name for sub in EXCLUDED_NAME_SUBSTRINGS):
        return False

    if shop == "supermarket":
        return True

    if is_costco_warehouse(tags):
        return True

    return False


def feature_tags(properties: dict[str, Any]) -> dict[str, Any]:
    """Normalize GeoJSON properties to tag-like dict for filtering."""
    skip = {"@id", "type", "source_geometry", "osm_id", "name", "shop", "brand"}
    tags: dict[str, Any] = {}
    for key in ("name", "shop", "brand"):
        if properties.get(key) is not None:
            tags[key] = properties[key]
    for key, value in properties.items():
        if key in skip or key.startswith("@"):
            continue
        if key not in tags:
            tags[key] = value
    return tags


def inclusion_rank(tags: dict[str, Any]) -> int:
    """Higher wins when deduping multiple OSM objects at one site."""
    if is_costco_warehouse(tags):
        return 50
    if _norm(str(tags.get("shop"))) == "supermarket":
        return 40
    return 0
