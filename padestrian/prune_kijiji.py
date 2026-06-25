"""Detect and remove expired Kijiji listings from the catalog."""

from __future__ import annotations

import json
import re
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from urllib.parse import parse_qs, urlsplit

from padestrian.paths import LISTINGS_JSON_PATH

# Kijiji __NEXT_DATA__ listing statuses that mean the ad is still live.
_ACTIVE_STATUSES = frozenset({"ACTIVE", "LIVE"})
_REMOVED_STATUSES = frozenset({"REMOVED", "DELETED", "EXPIRED", "INACTIVE", "SOLD"})

_NEXT_DATA_RE = re.compile(
    r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>',
    re.DOTALL,
)

_DEFAULT_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-CA,en;q=0.9",
}


@dataclass
class PruneStats:
    checked: int = 0
    removed: int = 0
    kept: int = 0
    skipped: int = 0
    errors: int = 0


def is_kijiji_listing(row: dict[str, Any]) -> bool:
    listing_id = row.get("id")
    if isinstance(listing_id, str) and listing_id.startswith("kijiji-"):
        return True
    return str(row.get("source") or "").lower() == "kijiji"


def kijiji_url(row: dict[str, Any]) -> str | None:
    url = str(row.get("url") or "").strip()
    if url and "kijiji.ca" in url:
        return url
    listing_id = str(row.get("id") or "")
    if listing_id.startswith("kijiji-"):
        numeric = listing_id.removeprefix("kijiji-")
        if numeric.isdigit():
            return f"https://www.kijiji.ca/v-apartments-condos/ottawa/listing/{numeric}"
    return None


def _listing_status_from_html(html: str) -> str | None:
    """Read RealEstateListing status from Kijiji's __NEXT_DATA__ payload."""
    match = _NEXT_DATA_RE.search(html)
    if not match:
        return None
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError:
        return None

    apollo = data.get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__")
    if not isinstance(apollo, dict):
        return None

    for key, value in apollo.items():
        if not key.startswith("RealEstateListing:") or not isinstance(value, dict):
            continue
        status = value.get("status")
        if isinstance(status, str) and status.strip():
            return status.strip().upper()
    return None


def _detail_listing_id(url: str) -> str | None:
    path = urlsplit(url).path
    m = re.search(r"/(\d+)/?$", path)
    return m.group(1) if m else None


def redirected_after_removal(original_url: str, response: httpx.Response) -> bool:
    """
    Kijiji often 302s removed ads to the category search page with ?adRemoved=<id>
    instead of returning 404.
    """
    final = str(response.url)
    final_lower = final.lower()
    if "adremoved=" in final_lower:
        return True

    qs = parse_qs(urlsplit(final).query)
    if qs.get("adRemoved") or qs.get("adremoved"):
        return True

    listing_id = _detail_listing_id(original_url)
    if not listing_id:
        return False

    orig_path = urlsplit(original_url).path
    final_path = urlsplit(final).path
    if "/v-" in orig_path and listing_id not in final_path:
        if "/b-" in final_path or "c37l" in final_path:
            return True
    return False


def is_listing_expired(url: str, client: httpx.Client) -> bool | None:
    """
    Return True if the ad appears gone, False if still live, None if unknown (keep).
    """
    try:
        response = client.get(url, follow_redirects=True)
    except httpx.RequestError:
        return None

    if response.status_code in (404, 410):
        return True
    if response.status_code >= 500:
        return None

    final_url = str(response.url).lower()
    if "/deleted" in final_url:
        return True

    if redirected_after_removal(url, response):
        return True

    if response.status_code >= 400:
        return None

    status = _listing_status_from_html(response.text)
    if status is not None:
        if status in _REMOVED_STATUSES:
            return True
        return status not in _ACTIVE_STATUSES

    return None


def prune_kijiji_listings(
    listings: list[dict[str, Any]],
    *,
    dry_run: bool = False,
    delay: float = 0.8,
) -> tuple[list[dict[str, Any]], PruneStats, list[str]]:
    """
    Return (updated listings, stats, ids removed).
    Non-Kijiji rows are always kept.
    """
    stats = PruneStats()
    removed_ids: list[str] = []
    kept_rows: list[dict[str, Any]] = []

    with httpx.Client(timeout=25.0, headers=_DEFAULT_HEADERS) as client:
        for row in listings:
            if not isinstance(row, dict) or not is_kijiji_listing(row):
                kept_rows.append(row)
                continue

            stats.checked += 1
            url = kijiji_url(row)
            listing_id = str(row.get("id") or "?")

            if not url:
                stats.skipped += 1
                kept_rows.append(row)
                continue

            expired = is_listing_expired(url, client)
            if expired is True:
                stats.removed += 1
                removed_ids.append(listing_id)
                print(f"  remove  {listing_id}")
                if delay > 0:
                    time.sleep(delay)
                continue

            if expired is None:
                stats.errors += 1
                print(f"  keep?   {listing_id}  (could not verify)")
                kept_rows.append(row)
            else:
                stats.kept += 1
                print(f"  keep    {listing_id}")
                kept_rows.append(row)

            if delay > 0:
                time.sleep(delay)

    if dry_run:
        return listings, stats, removed_ids

    return kept_rows, stats, removed_ids


def run_prune_kijiji(
    path: Path = LISTINGS_JSON_PATH,
    *,
    dry_run: bool = False,
    delay: float = 0.8,
) -> PruneStats:
    from padestrian.config import listings_backend
    from padestrian.listings import load_catalog, save_catalog

    data = load_catalog(path)
    listings = [x for x in data["listings"] if isinstance(x, dict)]
    before_kijiji = sum(1 for x in listings if is_kijiji_listing(x))

    backend = listings_backend()
    label = "Supabase" if backend == "supabase" else str(path)
    print(f"Checking {before_kijiji} Kijiji listing(s) in {label} …")
    updated, stats, removed_ids = prune_kijiji_listings(
        listings,
        dry_run=dry_run,
        delay=delay,
    )

    if dry_run:
        print(f"\nDry run: would remove {stats.removed}, keep {stats.kept} verified active.")
        if stats.errors:
            print(f"  {stats.errors} could not be verified (would keep).")
        return stats

    if backend == "supabase":
        from padestrian.db import deactivate_listings

        deactivate_listings(removed_ids)
        print(f"\nDeactivated {stats.removed} expired; kept {stats.kept} active Kijiji ads.")
        print(f"  Active catalog: {len(updated)} listings in Supabase")
    else:
        from datetime import datetime, timezone

        data["listings"] = updated
        data["generated_at"] = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
        save_catalog(data, path)

        kijiji_only = [x for x in updated if is_kijiji_listing(x)]
        kijiji_path = path.with_name("listings.kijiji.json")
        kijiji_payload = {
            "city": data.get("city") or "Ottawa, ON",
            "source": "kijiji scrape",
            "generated_at": data["generated_at"],
            "listings": kijiji_only,
        }
        save_catalog(kijiji_payload, kijiji_path)

        print(f"\nRemoved {stats.removed} expired; kept {stats.kept} active Kijiji ads.")
        print(f"  Catalog: {len(updated)} total listings -> {path}")
        print(f"  Kijiji snapshot ({len(kijiji_only)}): {kijiji_path}")

    if stats.errors:
        print(f"  {stats.errors} could not be verified (left in catalog).")
    print("Next: python -m padestrian validate-listings && python -m padestrian filter-listings")
    return stats
