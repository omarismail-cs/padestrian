"""Playwright scraper for rental listings (Kijiji Ottawa)."""

from __future__ import annotations

import json
import random
import re
import time
from dataclasses import dataclass
from typing import Any
from urllib.parse import urljoin, urlsplit, urlunsplit

import httpx
from playwright.sync_api import TimeoutError as PlaywrightTimeoutError
from playwright.sync_api import sync_playwright

from padestrian.geocode import geocode_address

KIJIJI_OTTAWA_RENTALS_URL = "https://www.kijiji.ca/b-apartments-condos/ottawa/c37l1700185"
_OTTAWA_PROXIMITY = (-75.6972, 45.4215)  # downtown Ottawa


@dataclass(frozen=True)
class ScrapeResult:
    """Raw listing details captured from the source page."""

    url: str
    title: str | None
    price_text: str | None
    bedrooms_text: str | None
    bathrooms_text: str | None
    address: str | None
    description: str | None
    source: str = "kijiji"


def scrape_kijiji_urls(max_pages: int) -> list[str]:
    """Collect listing detail URLs from Kijiji listing index pages."""
    if max_pages < 1:
        return []

    urls: list[str] = []
    seen: set[str] = set()

    with sync_playwright() as pw:
        browser = pw.chromium.launch(headless=True)
        context = browser.new_context()
        page = context.new_page()

        for page_num in range(1, max_pages + 1):
            url = KIJIJI_OTTAWA_RENTALS_URL if page_num == 1 else f"{KIJIJI_OTTAWA_RENTALS_URL}?page={page_num}"
            try:
                page.goto(url, wait_until="domcontentloaded", timeout=45_000)
            except PlaywrightTimeoutError:
                continue

            # Kijiji card links include /v-apartments-condos/ ... /<id>
            anchors = page.eval_on_selector_all(
                "a[href*='/v-apartments-condos/']",
                "els => els.map(e => e.getAttribute('href')).filter(Boolean)",
            )
            if not anchors:
                break

            new_on_page = 0
            for href in anchors:
                full = urljoin("https://www.kijiji.ca", href)
                full = _canonical_kijiji_url(full)
                if "/v-apartments-condos/" not in full:
                    continue
                if full in seen:
                    continue
                seen.add(full)
                urls.append(full)
                new_on_page += 1

            # If this page produced no new URLs, stop pagination.
            if new_on_page == 0:
                break

            time.sleep(random.uniform(1.0, 2.0))

        context.close()
        browser.close()

    return urls


def scrape_listing_detail(page: Any, url: str) -> dict[str, Any]:
    """Scrape one Kijiji listing detail page and return raw fields."""
    try:
        page.goto(url, wait_until="domcontentloaded", timeout=45_000)

        # Try JSON-LD first for stable structured fields.
        ld_text = _try_text(page, "script[type='application/ld+json']")
        ld: dict[str, Any] = {}
        if isinstance(ld_text, str) and ld_text.strip():
            try:
                parsed = json.loads(ld_text)
                if isinstance(parsed, list):
                    ld = next((x for x in parsed if isinstance(x, dict)), {})
                elif isinstance(parsed, dict):
                    ld = parsed
            except json.JSONDecodeError:
                ld = {}

        title = (
            (ld.get("name") if ld else None)
            or _try_text(page, "h1")
        )
        description = (
            (ld.get("description") if ld else None)
            or _try_text(page, "[data-qa-id='ad-description']")
        )
        ld_price = _price_from_jsonld(ld)
        price_text = (
            _try_text(page, "[data-qa-id='ad-price-container']")
            or _try_text(page, "[class*='price']")
            or ld_price
        )
        address = (
            _try_text(page, "[data-qa-id='ad-address']")
            or _try_text(page, "[class*='address']")
            or _address_from_jsonld(ld)
        )

        bedrooms_text, bathrooms_text = _pick_bed_bath_from_attribute_lines(
            _kijiji_attribute_lines_from_page(page)
        )

    except Exception as exc:  # noqa: BLE001
        print(f"[scrape_listing_detail] failed for {url}: {exc}")
        return {
            "url": url,
            "title": None,
            "price_text": None,
            "bedrooms_text": None,
            "bathrooms_text": None,
            "address": None,
            "description": None,
            "source": "kijiji",
        }

    result = ScrapeResult(
        url=url,
        title=_clean_text(title),
        price_text=_clean_text(price_text),
        bedrooms_text=_clean_text(bedrooms_text),
        bathrooms_text=_clean_text(bathrooms_text),
        address=_clean_text(address),
        description=_clean_text(description),
    )
    return result.__dict__


def normalize_listing(raw: dict[str, Any]) -> dict[str, Any] | None:
    """
    Convert raw scraped listing fields into the listings.json schema.

    Returns None when required fields cannot be derived.
    """
    url = str(raw.get("url") or "").strip()
    if not url:
        return None

    listing_id = _extract_kijiji_id(url)
    if not listing_id:
        return None

    price = _parse_price(raw.get("price_text"))
    if price is None or price <= 0:
        return None

    beds = _parse_bedrooms(
        raw.get("bedrooms_text"),
        title=raw.get("title"),
        description=raw.get("description"),
    )
    if beds is None:
        return None

    address_query = _best_address_query(
        raw.get("address"),
        raw.get("title"),
        raw.get("description"),
    )

    geo = None
    raw_lat = raw.get("lat")
    raw_lon = raw.get("lon")
    if raw_lat is not None and raw_lon is not None:
        try:
            lat_f = float(raw_lat)
            lon_f = float(raw_lon)
            from padestrian.geocode import _in_bbox

            if _in_bbox(lon_f, lat_f):
                label = (
                    str(raw.get("address") or "").strip()
                    or address_query
                    or str(raw.get("title") or "").strip()
                )
                if label:
                    from padestrian.geocode import GeocodeResult

                    geo = GeocodeResult(lon=lon_f, lat=lat_f, label=label)
        except (TypeError, ValueError):
            geo = None

    if geo is None:
        if not address_query:
            return None
        with httpx.Client(timeout=20.0) as client:
            geo = geocode_address(address_query, proximity=_OTTAWA_PROXIMITY, client=client)
        if geo is None:
            return None

    title = str(raw.get("title") or "").strip() or address_query
    bathrooms = _parse_bathrooms(
        raw.get("bathrooms_text"),
        title=title,
        description=raw.get("description"),
        url=url,
    )

    listing: dict[str, Any] = {
        "id": f"kijiji-{listing_id}",
        "title": title,
        "address": geo.label,
        "lat": geo.lat,
        "lon": geo.lon,
        "rent_cad": int(price),
        "bedrooms": int(beds),
        "source": "kijiji",
        "url": url,
    }
    if bathrooms is not None:
        listing["bathrooms"] = bathrooms
    return listing


def _clean_text(value: Any) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    return re.sub(r"\s+", " ", text)


def _kijiji_attribute_lines_from_page(page: Any) -> list[str]:
    """Read VIP attribute chips (e.g. '1 Bathrooms') from the listing page."""
    lines: list[str] = []
    try:
        page.wait_for_selector(
            '[data-testid="vip-attributes-section"]',
            timeout=8_000,
            state="attached",
        )
    except PlaywrightTimeoutError:
        pass

    vip = page.eval_on_selector(
        '[data-testid="vip-attributes-section"]',
        """section => {
            if (!section) return [];
            return Array.from(section.querySelectorAll('p'))
                .map(p => (p.textContent || '').trim())
                .filter(Boolean);
        }""",
    )
    if isinstance(vip, list):
        lines.extend(str(x).strip() for x in vip if str(x).strip())

    legacy = page.eval_on_selector_all(
        "[data-qa-id='item-attribute'], [class*='attribute']",
        "els => els.map(e => (e.textContent || '').trim()).filter(Boolean)",
    )
    if isinstance(legacy, list):
        for text in legacy:
            t = str(text).strip()
            if t and t not in lines:
                lines.append(t)
    return lines


def _kijiji_attribute_lines_from_html(html: str) -> list[str]:
    """Parse VIP attribute lines from server-rendered HTML (no Playwright)."""
    for marker in ('data-testid="vip-attributes-section"', "data-testid='vip-attributes-section'"):
        idx = html.find(marker)
        if idx == -1:
            continue
        chunk = html[idx : idx + 12_000]
        lines = [
            t
            for m in re.finditer(r"<p[^>]*>([^<]+)</p>", chunk, re.IGNORECASE)
            if (t := _clean_text(m.group(1)))
        ]
        if lines:
            return lines
    return []


def _pick_bed_bath_from_attribute_lines(
    lines: list[str],
) -> tuple[str | None, str | None]:
    bedrooms_text = None
    bathrooms_text = None
    for text in lines:
        low = text.lower()
        if bedrooms_text is None and (
            "bedroom" in low or re.search(r"\bbr\b", low)
        ):
            bedrooms_text = text
        if bathrooms_text is None and (
            "bathroom" in low
            or " bath" in low
            or re.search(r"\bba\b", low)
        ):
            bathrooms_text = text
    return bedrooms_text, bathrooms_text


def fetch_kijiji_bathrooms_from_url(
    url: str,
    *,
    client: httpx.Client | None = None,
) -> float | None:
    """
    Fetch listing HTML and parse bathrooms from vip-attributes-section.

    Uses plain HTTP (same idea as prune-kijiji); no Playwright required.
    """
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
        ),
        "Accept-Language": "en-CA,en;q=0.9",
    }
    own_client = client is None
    if own_client:
        client = httpx.Client(timeout=25.0, headers=headers, follow_redirects=True)
    try:
        response = client.get(url)
        if response.status_code >= 400:
            return None
        _, bathrooms_text = _pick_bed_bath_from_attribute_lines(
            _kijiji_attribute_lines_from_html(response.text)
        )
        return _parse_bathrooms(bathrooms_text, url=url)
    except httpx.RequestError:
        return None
    finally:
        if own_client:
            client.close()


def _try_text(page: Any, selector: str) -> str | None:
    """Return textContent for selector or None when missing."""
    try:
        loc = page.locator(selector).first
        if loc.count() == 0:
            return None
        return loc.text_content()
    except Exception:  # noqa: BLE001
        return None


def _canonical_kijiji_url(url: str) -> str:
    """Drop gallery/query variants so one ad has one URL."""
    parts = urlsplit(url)
    return urlunsplit((parts.scheme, parts.netloc, parts.path, "", ""))


def extract_kijiji_id(url: str) -> str | None:
    """Public helper for parsing the numeric Kijiji listing id from URL."""
    return _extract_kijiji_id(url)


def _price_from_jsonld(ld: dict[str, Any]) -> str | None:
    if not ld:
        return None
    offers = ld.get("offers")
    if isinstance(offers, dict):
        price = offers.get("price")
        if price is not None:
            return str(price)
    return None


def _address_from_jsonld(ld: dict[str, Any]) -> str | None:
    if not ld:
        return None
    addr = ld.get("address")
    if isinstance(addr, dict):
        parts = [
            addr.get("streetAddress"),
            addr.get("addressLocality"),
            addr.get("addressRegion"),
            addr.get("postalCode"),
        ]
        text = ", ".join(str(p).strip() for p in parts if p)
        return text or None
    if isinstance(addr, str):
        return addr.strip() or None
    return None


def _extract_kijiji_id(url: str) -> str | None:
    # Usually final path segment is the numeric listing id.
    m = re.search(r"/(\d+)(?:\?|$)", url)
    return m.group(1) if m else None


def _parse_price(value: Any) -> int | None:
    text = _clean_text(value)
    if not text:
        return None
    m = re.search(r"\$?\s*([\d,]{3,})", text)
    if not m:
        return None
    try:
        return int(m.group(1).replace(",", ""))
    except ValueError:
        return None


def _parse_bedrooms(value: Any, *, title: Any, description: Any) -> int | None:
    base = " ".join(filter(None, [_clean_text(value), _clean_text(title), _clean_text(description)]))
    low = base.lower()
    if "studio" in low or "bachelor" in low:
        return 0
    m = re.search(r"(\d+)\s*(?:bed|bedroom|br)\b", low)
    if not m:
        m = re.search(r"\b(\d+)\s*(?:bd)\b", low)
    if not m:
        return None
    try:
        beds = int(m.group(1))
    except ValueError:
        return None
    if beds < 0 or beds > 10:
        return None
    return beds


_WORD_BATHS = {
    "one": 1.0,
    "two": 2.0,
    "three": 3.0,
    "four": 4.0,
}


def _parse_bathrooms(
    value: Any,
    *,
    title: Any = None,
    description: Any = None,
    url: Any = None,
) -> float | None:
    base = " ".join(
        filter(
            None,
            [
                _clean_text(value),
                _clean_text(title),
                _clean_text(description),
                _clean_text(url),
            ],
        )
    )
    if not base:
        return None

    low = base.lower()

    m = re.search(r"(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba)s?\b", low)
    if not m:
        m = re.search(r"(\d+(?:\.\d+)?)[-_](?:bath|bathroom|ba)s?\b", low)
    if m:
        try:
            baths = float(m.group(1))
            if 0 < baths <= 10:
                return baths
        except ValueError:
            pass

    for word, count in _WORD_BATHS.items():
        if re.search(rf"\b{word}\s+(?:bath|bathroom)s?\b", low):
            return count
        if re.search(rf"{word}[-_](?:bath|bathroom)s?\b", low):
            return count

    return None


def _normalize_address(value: Any) -> str | None:
    text = _clean_text(value)
    if not text:
        return None
    # Ensure geocoder stays in Ottawa context.
    if "ottawa" not in text.lower():
        text = f"{text}, Ottawa, ON"
    return text


_STREET_TOKEN_RE = r"(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|crescent|cres|boulevard|blvd|way|place|pl|court|ct|terrace|terr|parkway|pkwy|circle|cir|gate|path|trail|trl)"
_NUMBERED_ADDRESS_RE = re.compile(
    rf"\b(\d{{1,5}}\s+[A-Za-z0-9'’\.-]+(?:\s+[A-Za-z0-9'’\.-]+){{0,6}}\s+{_STREET_TOKEN_RE})\b",
    re.IGNORECASE,
)


def _has_civic_number(address: str) -> bool:
    return bool(re.search(r"^\s*\d{1,5}\s+\S+", address))


def _extract_numbered_address(text: str) -> str | None:
    m = _NUMBERED_ADDRESS_RE.search(text)
    if not m:
        return None
    return m.group(1).strip()


def _best_address_query(address: Any, title: Any, description: Any) -> str | None:
    """
    Prefer precise address candidates with civic number.

    Returns normalized address string suitable for geocoding, or None.
    """
    # 1) Use explicit address field if it already has a civic number.
    direct = _normalize_address(address)
    if direct and _has_civic_number(direct):
        return direct

    # 2) Fall back to extracting a numbered street from title/description.
    for raw in (_clean_text(title), _clean_text(description), _clean_text(address)):
        if not raw:
            continue
        extracted = _extract_numbered_address(raw)
        if extracted:
            return _normalize_address(extracted)

    # 3) If still no civic number, skip as low-confidence.
    return None

