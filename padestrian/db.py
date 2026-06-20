"""Supabase listing catalog — upsert, deactivate, score updates, GeoJSON export."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from supabase import Client, create_client

from padestrian.config import require_env

_client: Client | None = None

_DB_COLUMNS = frozenset(
    {
        "id",
        "title",
        "address",
        "lat",
        "lon",
        "rent_cad",
        "bedrooms",
        "bathrooms",
        "neighborhood",
        "source",
        "url",
        "active",
        "near_grocery",
        "near_transit",
        "eligible",
        "walk_minutes",
        "transit_via",
        "nearest_stop_m",
        "scored_at",
    }
)


def get_client() -> Client:
    global _client
    if _client is None:
        _client = create_client(
            require_env("SUPABASE_URL"),
            require_env("SUPABASE_SERVICE_ROLE_KEY"),
        )
    return _client


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def catalog_row_to_db(row: dict[str, Any], *, active: bool = True) -> dict[str, Any]:
    rent = float(row["rent_cad"])
    rent_cad = int(rent) if rent.is_integer() else int(round(rent))
    out: dict[str, Any] = {
        "id": str(row["id"]),
        "title": row.get("title"),
        "address": str(row["address"]),
        "lat": float(row["lat"]),
        "lon": float(row["lon"]),
        "rent_cad": rent_cad,
        "bedrooms": int(row["bedrooms"]),
        "bathrooms": float(row["bathrooms"]) if row.get("bathrooms") is not None else None,
        "neighborhood": str(row.get("neighborhood") or ""),
        "source": str(row.get("source") or "demo"),
        "url": row.get("url"),
        "active": active,
        "updated_at": _now_iso(),
    }
    for key in ("near_grocery", "near_transit", "eligible", "walk_minutes", "transit_via", "nearest_stop_m"):
        if key in row and row[key] is not None:
            out[key] = row[key]
    if row.get("scored_at"):
        out["scored_at"] = row["scored_at"]
    return out


def db_row_to_catalog(row: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {
        "id": row["id"],
        "address": row["address"],
        "lat": float(row["lat"]),
        "lon": float(row["lon"]),
        "rent_cad": int(row["rent_cad"]),
        "bedrooms": int(row["bedrooms"]),
        "source": row.get("source") or "demo",
    }
    if row.get("title"):
        out["title"] = row["title"]
    if row.get("bathrooms") is not None:
        out["bathrooms"] = float(row["bathrooms"])
    if row.get("neighborhood"):
        out["neighborhood"] = row["neighborhood"]
    if row.get("url"):
        out["url"] = row["url"]
    for key in ("near_grocery", "near_transit", "eligible", "walk_minutes", "transit_via", "nearest_stop_m"):
        if row.get(key) is not None:
            out[key] = row[key]
    return out


def _select_all(query: Any) -> list[dict[str, Any]]:
    """Paginate through Supabase results (default page size 1000)."""
    rows: list[dict[str, Any]] = []
    page_size = 1000
    offset = 0
    while True:
        batch = query.range(offset, offset + page_size - 1).execute().data or []
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size
    return rows


def fetch_active_listings() -> list[dict[str, Any]]:
    client = get_client()
    rows = _select_all(client.table("listings").select("*").eq("active", True).order("id"))
    return [db_row_to_catalog(r) for r in rows]


def fetch_kijiji_ids() -> set[str]:
    client = get_client()
    rows = _select_all(client.table("listings").select("id").like("id", "kijiji-%"))
    return {str(r["id"]) for r in rows if r.get("id")}


def fetch_catalog_dict() -> dict[str, Any]:
    rows = fetch_active_listings()
    scored_at_values = []
    client = get_client()
    meta_rows = _select_all(
        client.table("listings")
        .select("scored_at, updated_at")
        .eq("active", True)
    )
    for r in meta_rows:
        if r.get("scored_at"):
            scored_at_values.append(r["scored_at"])
        elif r.get("updated_at"):
            scored_at_values.append(r["updated_at"])
    generated_at = max(scored_at_values) if scored_at_values else _now_iso()
    return {
        "city": "Ottawa, ON",
        "source": "supabase",
        "generated_at": generated_at,
        "listings": rows,
    }


def upsert_listings(rows: list[dict[str, Any]], *, active: bool = True) -> int:
    if not rows:
        return 0
    client = get_client()
    payload = [catalog_row_to_db(r, active=active) for r in rows]
    for i in range(0, len(payload), 100):
        client.table("listings").upsert(payload[i : i + 100], on_conflict="id").execute()
    return len(payload)


def deactivate_listings(ids: list[str]) -> int:
    if not ids:
        return 0
    client = get_client()
    updated = 0
    for i in range(0, len(ids), 100):
        batch = ids[i : i + 100]
        client.table("listings").update({"active": False, "updated_at": _now_iso()}).in_("id", batch).execute()
        updated += len(batch)
    return updated


def update_scores_batch(updates: list[dict[str, Any]]) -> None:
    """Each update dict must include id plus score fields."""
    if not updates:
        return
    client = get_client()
    scored_at = _now_iso()
    for row in updates:
        listing_id = row["id"]
        patch = {k: row[k] for k in _DB_COLUMNS if k in row and k != "id"}
        patch["scored_at"] = scored_at
        patch["updated_at"] = scored_at
        client.table("listings").update(patch).eq("id", listing_id).execute()


def save_catalog_to_db(data: dict[str, Any]) -> int:
    listings = [x for x in data.get("listings", []) if isinstance(x, dict)]
    return upsert_listings(listings)
