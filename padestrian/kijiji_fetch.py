"""Fetch a single Kijiji listing via HTTP + __NEXT_DATA__ Apollo parsing."""

from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlsplit, urlunsplit

import httpx

from padestrian.geocode import _in_bbox
from padestrian.prune_kijiji import _DEFAULT_HEADERS, _NEXT_DATA_RE, redirected_after_removal
from padestrian.scraper import (
    _clean_text,
    _kijiji_attribute_lines_from_html,
    _pick_bed_bath_from_attribute_lines,
    extract_kijiji_id,
)

_ACTIVE_STATUSES = frozenset({"ACTIVE", "LIVE"})


def canonical_kijiji_url(url: str) -> str:
    """Drop query/gallery variants so one ad has one URL."""
    parts = urlsplit(url.strip())
    return urlunsplit((parts.scheme or "https", parts.netloc, parts.path, "", ""))


def validate_kijiji_listing_url(url: str) -> str | None:
    """Return canonical URL when valid, else None."""
    text = url.strip()
    if "kijiji.ca" not in text.lower():
        return None
    if not text.startswith("http"):
        text = f"https://{text.lstrip('/')}"
    canonical = canonical_kijiji_url(text)
    if not extract_kijiji_id(canonical):
        return None
    if "/v-apartments-condos/" not in canonical and "/v-" not in canonical:
        # Allow any detail path with numeric id (rooms, sublets, etc.)
        if not re.search(r"/\d+(?:\?|$)", canonical):
            return None
    return canonical


def _first_text(obj: dict[str, Any], *keys: str) -> str | None:
    for key in keys:
        val = obj.get(key)
        if isinstance(val, str) and val.strip():
            return _clean_text(val)
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            return str(val)
        if isinstance(val, dict):
            nested = _first_text(val, "amount", "value", "text", "name", "label")
            if nested:
                return nested
    return None


def _first_float(obj: dict[str, Any], *keys: str) -> float | None:
    for key in keys:
        val = obj.get(key)
        if isinstance(val, (int, float)) and not isinstance(val, bool):
            return float(val)
        if isinstance(val, str):
            try:
                return float(val.strip())
            except ValueError:
                continue
    return None


def _attributes_map(listing: dict[str, Any]) -> dict[str, str]:
    out: dict[str, str] = {}
    attrs = listing.get("attributes")
    if not isinstance(attrs, list):
        return out
    for item in attrs:
        if not isinstance(item, dict):
            continue
        label = _clean_text(item.get("label") or item.get("name") or item.get("key"))
        value = _clean_text(item.get("value") or item.get("text"))
        if label and value:
            out[label.lower()] = value
    return out


def _listing_from_apollo(apollo: dict[str, Any]) -> dict[str, Any] | None:
    for key, value in apollo.items():
        if not key.startswith("RealEstateListing:") or not isinstance(value, dict):
            continue
        listing = value
        status = str(listing.get("status") or "").strip().upper()
        if status and status not in _ACTIVE_STATUSES:
            return None

        attrs = _attributes_map(listing)
        bedrooms_text = (
            attrs.get("bedrooms")
            or _first_text(listing, "bedrooms", "numberOfBedrooms", "bedroomsText")
        )
        bathrooms_text = (
            attrs.get("bathrooms")
            or _first_text(listing, "bathrooms", "numberOfBathrooms", "bathroomsText")
        )

        price_text = (
            _first_text(listing, "price", "priceAmount", "priceRaw", "rentMonthly")
            or attrs.get("rent")
        )
        location = listing.get("location")
        loc_address = (
            _first_text(location, "address", "name")
            if isinstance(location, dict)
            else None
        )
        address = _first_text(
            listing,
            "fullAddress",
            "mapAddress",
            "address",
            "streetAddress",
        ) or loc_address

        lat = _first_float(listing, "latitude", "lat")
        lon = _first_float(listing, "longitude", "lon", "lng")

        return {
            "title": _first_text(listing, "title", "name"),
            "description": _first_text(listing, "description"),
            "price_text": price_text,
            "bedrooms_text": bedrooms_text,
            "bathrooms_text": bathrooms_text,
            "address": address,
            "lat": lat,
            "lon": lon,
        }
    return None


def _jsonld_from_html(html: str) -> dict[str, Any]:
    m = re.search(
        r"<script[^>]+type=['\"]application/ld\+json['\"][^>]*>(.*?)</script>",
        html,
        re.DOTALL | re.IGNORECASE,
    )
    if not m:
        return {}
    try:
        parsed = json.loads(m.group(1))
    except json.JSONDecodeError:
        return {}
    if isinstance(parsed, list):
        return next((x for x in parsed if isinstance(x, dict)), {})
    if isinstance(parsed, dict):
        return parsed
    return {}


def parse_listing_raw_from_html(html: str, url: str) -> dict[str, Any]:
    """Parse raw scrape fields from listing HTML."""
    base: dict[str, Any] = {
        "url": url,
        "title": None,
        "price_text": None,
        "bedrooms_text": None,
        "bathrooms_text": None,
        "address": None,
        "description": None,
        "lat": None,
        "lon": None,
        "source": "kijiji",
    }

    match = _NEXT_DATA_RE.search(html)
    apollo_listing: dict[str, Any] | None = None
    if match:
        try:
            data = json.loads(match.group(1))
            apollo = data.get("props", {}).get("pageProps", {}).get("__APOLLO_STATE__")
            if isinstance(apollo, dict):
                apollo_listing = _listing_from_apollo(apollo)
        except json.JSONDecodeError:
            pass

    if apollo_listing:
        for key, val in apollo_listing.items():
            if val is not None:
                base[key] = val

    ld = _jsonld_from_html(html)
    if ld:
        if not base["title"]:
            base["title"] = _clean_text(ld.get("name"))
        if not base["description"]:
            base["description"] = _clean_text(ld.get("description"))
        offers = ld.get("offers")
        if not base["price_text"] and isinstance(offers, dict):
            price = offers.get("price")
            if price is not None:
                base["price_text"] = str(price)
        addr = ld.get("address")
        if not base["address"]:
            if isinstance(addr, dict):
                parts = [
                    addr.get("streetAddress"),
                    addr.get("addressLocality"),
                    addr.get("addressRegion"),
                ]
                text = ", ".join(str(p).strip() for p in parts if p)
                base["address"] = _clean_text(text)
            elif isinstance(addr, str):
                base["address"] = _clean_text(addr)

    attr_lines = _kijiji_attribute_lines_from_html(html)
    beds_attr, baths_attr = _pick_bed_bath_from_attribute_lines(attr_lines)
    if not base["bedrooms_text"] and beds_attr:
        base["bedrooms_text"] = beds_attr
    if not base["bathrooms_text"] and baths_attr:
        base["bathrooms_text"] = baths_attr

    if base.get("lat") is not None and base.get("lon") is not None:
        lat = float(base["lat"])
        lon = float(base["lon"])
        if not _in_bbox(lon, lat):
            base["lat"] = None
            base["lon"] = None

    return base


def fetch_listing_raw(
    url: str,
    *,
    client: httpx.Client | None = None,
) -> dict[str, Any]:
    """HTTP-fetch one Kijiji listing and return raw scrape fields."""
    canonical = validate_kijiji_listing_url(url)
    if not canonical:
        return {
            "url": url,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "lat": None,
            "lon": None,
            "source": "kijiji",
            "error": "invalid_url",
        }

    own_client = client is None
    if own_client:
        client = httpx.Client(
            timeout=25.0,
            headers=_DEFAULT_HEADERS,
            follow_redirects=True,
        )
    try:
        response = client.get(canonical)
    except httpx.RequestError as exc:
        return {
            "url": canonical,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "lat": None,
            "lon": None,
            "source": "kijiji",
            "error": f"fetch_failed: {exc}",
        }
    finally:
        if own_client:
            client.close()

    if response.status_code in (404, 410):
        return {
            "url": canonical,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "lat": None,
            "lon": None,
            "source": "kijiji",
            "error": "listing_not_found",
        }

    if redirected_after_removal(canonical, response):
        return {
            "url": canonical,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "lat": None,
            "lon": None,
            "source": "kijiji",
            "error": "listing_not_found",
        }

    final_url = str(response.url).lower()
    if "/deleted" in final_url:
        return {
            "url": canonical,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "lat": None,
            "lon": None,
            "source": "kijiji",
            "error": "listing_deleted",
        }

    if response.status_code >= 400:
        return {
            "url": canonical,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "lat": None,
            "lon": None,
            "source": "kijiji",
            "error": f"http_{response.status_code}",
        }

    raw = parse_listing_raw_from_html(response.text, canonical)
    if not raw.get("title") and not raw.get("price_text"):
        raw["error"] = "parse_failed"
    return raw
