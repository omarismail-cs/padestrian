import type { Feature, Point } from "geojson"
import { geocodeAddress } from "@/lib/geocode"
import { inOttawaBbox } from "@/lib/ottawa-bbox"
import type { PointScore } from "@/lib/score-point"

const NEXT_DATA_RE = /<script id="__NEXT_DATA__"[^>]*>(.*?)<\/script>/s
const JSONLD_RE =
  /<script[^>]+type=['"]application\/ld\+json['"][^>]*>(.*?)<\/script>/is
const ACTIVE_STATUSES = new Set(["ACTIVE", "LIVE"])
const STREET_TOKEN_RE =
  /(?:street|st|avenue|ave|road|rd|drive|dr|lane|ln|crescent|cres|boulevard|blvd|way|place|pl|court|ct|terrace|terr|parkway|pkwy|circle|cir|gate|path|trail|trl)/i
const NUMBERED_ADDRESS_RE = new RegExp(
  `\\b(\\d{1,5}\\s+[A-Za-z0-9''.-]+(?:\\s+[A-Za-z0-9''.-]+){0,6}\\s+${STREET_TOKEN_RE.source})\\b`,
  "i",
)

export interface KijijiRawListing {
  url: string
  title: string | null
  price_text: string | null
  bedrooms_text: string | null
  bathrooms_text: string | null
  address: string | null
  description: string | null
  lat: number | null
  lon: number | null
  error?: string
}

export interface ImportFailure {
  url: string
  reason: string
}

function cleanText(value: unknown): string | null {
  if (value == null) return null
  const text = String(value).trim().replace(/\s+/g, " ")
  return text || null
}

export function canonicalKijijiUrl(url: string): string {
  try {
    const parsed = new URL(url.trim())
    return `${parsed.protocol}//${parsed.host}${parsed.pathname}`
  } catch {
    return url.trim()
  }
}

export function extractKijijiId(url: string): string | null {
  const m = /\/(\d+)(?:\?|$)/.exec(url)
  return m ? m[1] : null
}

export function validateKijijiListingUrl(url: string): string | null {
  let text = url.trim()
  if (!text.toLowerCase().includes("kijiji.ca")) return null
  if (!text.startsWith("http")) text = `https://${text.replace(/^\/+/, "")}`
  const canonical = canonicalKijijiUrl(text)
  if (!extractKijijiId(canonical)) return null
  return canonical
}

function firstText(obj: Record<string, unknown>, ...keys: string[]): string | null {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === "string" && val.trim()) return cleanText(val)
    if (typeof val === "number" && Number.isFinite(val)) return String(val)
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const nested = firstText(val as Record<string, unknown>, "amount", "value", "text", "name", "label")
      if (nested) return nested
    }
  }
  return null
}

function firstFloat(obj: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const val = obj[key]
    if (typeof val === "number" && Number.isFinite(val)) return val
    if (typeof val === "string") {
      const n = Number.parseFloat(val.trim())
      if (Number.isFinite(n)) return n
    }
  }
  return null
}

function attributesMap(listing: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {}
  const attrs = listing.attributes
  if (!Array.isArray(attrs)) return out
  for (const item of attrs) {
    if (!item || typeof item !== "object") continue
    const row = item as Record<string, unknown>
    const label = cleanText(row.label ?? row.name ?? row.key)
    const value = cleanText(row.value ?? row.text)
    if (label && value) out[label.toLowerCase()] = value
  }
  return out
}

function listingFromApollo(apollo: Record<string, unknown>): Partial<KijijiRawListing> | null {
  for (const [key, value] of Object.entries(apollo)) {
    if (!key.startsWith("RealEstateListing:") || !value || typeof value !== "object") continue
    const listing = value as Record<string, unknown>
    const status = String(listing.status ?? "").trim().toUpperCase()
    if (status && !ACTIVE_STATUSES.has(status)) return null

    const attrs = attributesMap(listing)
    const location =
      listing.location && typeof listing.location === "object"
        ? (listing.location as Record<string, unknown>)
        : null

    let lat = firstFloat(listing, "latitude", "lat")
    let lon = firstFloat(listing, "longitude", "lon", "lng")
    if (lat != null && lon != null && !inOttawaBbox(lon, lat)) {
      lat = null
      lon = null
    }

    return {
      title: firstText(listing, "title", "name"),
      description: firstText(listing, "description"),
      price_text:
        firstText(listing, "price", "priceAmount", "priceRaw", "rentMonthly") ??
        attrs.rent ??
        null,
      bedrooms_text:
        attrs.bedrooms ?? firstText(listing, "bedrooms", "numberOfBedrooms", "bedroomsText"),
      bathrooms_text:
        attrs.bathrooms ??
        firstText(listing, "bathrooms", "numberOfBathrooms", "bathroomsText"),
      address:
        firstText(listing, "fullAddress", "mapAddress", "address", "streetAddress") ??
        (location ? firstText(location, "address", "name") : null),
      lat,
      lon,
    }
  }
  return null
}

function jsonLdFromHtml(html: string): Record<string, unknown> {
  const m = JSONLD_RE.exec(html)
  if (!m) return {}
  try {
    const parsed = JSON.parse(m[1]) as unknown
    if (Array.isArray(parsed)) {
      return (parsed.find((x) => x && typeof x === "object") as Record<string, unknown>) ?? {}
    }
    if (parsed && typeof parsed === "object") return parsed as Record<string, unknown>
  } catch {
    // ignore
  }
  return {}
}

function vipAttributeLines(html: string): string[] {
  for (const marker of ['data-testid="vip-attributes-section"', "data-testid='vip-attributes-section'"]) {
    const idx = html.indexOf(marker)
    if (idx === -1) continue
    const chunk = html.slice(idx, idx + 12_000)
    const lines: string[] = []
    const re = /<p[^>]*>([^<]+)<\/p>/gi
    let m: RegExpExecArray | null
    while ((m = re.exec(chunk)) !== null) {
      const t = cleanText(m[1])
      if (t) lines.push(t)
    }
    if (lines.length) return lines
  }
  return []
}

function pickBedBath(lines: string[]): { beds: string | null; baths: string | null } {
  let beds: string | null = null
  let baths: string | null = null
  for (const text of lines) {
    const low = text.toLowerCase()
    if (!beds && (low.includes("bedroom") || /\bbr\b/.test(low))) beds = text
    if (!baths && (low.includes("bathroom") || low.includes(" bath") || /\bba\b/.test(low))) {
      baths = text
    }
  }
  return { beds, baths }
}

export function parseListingRawFromHtml(html: string, url: string): KijijiRawListing {
  const base: KijijiRawListing = {
    url,
    title: null,
    price_text: null,
    bedrooms_text: null,
    bathrooms_text: null,
    address: null,
    description: null,
    lat: null,
    lon: null,
  }

  const match = NEXT_DATA_RE.exec(html)
  if (match) {
    try {
      const data = JSON.parse(match[1]) as {
        props?: { pageProps?: { __APOLLO_STATE__?: Record<string, unknown> } }
      }
      const apollo = data.props?.pageProps?.__APOLLO_STATE__
      if (apollo && typeof apollo === "object") {
        const parsed = listingFromApollo(apollo)
        if (parsed) Object.assign(base, parsed)
      }
    } catch {
      // ignore
    }
  }

  const ld = jsonLdFromHtml(html)
  if (ld.name && !base.title) base.title = cleanText(ld.name)
  if (ld.description && !base.description) base.description = cleanText(ld.description)
  const offers = ld.offers
  if (!base.price_text && offers && typeof offers === "object") {
    const price = (offers as Record<string, unknown>).price
    if (price != null) base.price_text = String(price)
  }
  const addr = ld.address
  if (!base.address) {
    if (addr && typeof addr === "object") {
      const parts = [
        (addr as Record<string, unknown>).streetAddress,
        (addr as Record<string, unknown>).addressLocality,
        (addr as Record<string, unknown>).addressRegion,
      ]
      const text = parts
        .map((p) => (p != null ? String(p).trim() : ""))
        .filter(Boolean)
        .join(", ")
      base.address = cleanText(text)
    } else if (typeof addr === "string") {
      base.address = cleanText(addr)
    }
  }

  const { beds, baths } = pickBedBath(vipAttributeLines(html))
  if (!base.bedrooms_text && beds) base.bedrooms_text = beds
  if (!base.bathrooms_text && baths) base.bathrooms_text = baths

  return base
}

function parsePrice(value: unknown): number | null {
  const text = cleanText(value)
  if (!text) return null
  if (/please\s+contact|contact\s+for\s+price|^\s*contact\s*$/i.test(text)) return null
  const m = /\$?\s*([\d,]{3,})/.exec(text)
  if (!m) return null
  const n = Number.parseInt(m[1].replace(/,/g, ""), 10)
  return Number.isFinite(n) ? n : null
}

function isContactForPrice(value: unknown): boolean {
  const text = cleanText(value)?.toLowerCase()
  if (!text) return true
  return (
    text.includes("please contact") ||
    text.includes("contact for price") ||
    text === "contact" ||
    text.includes("swap") ||
    text.includes("free")
  )
}

function parseBedrooms(value: unknown, title: unknown, description: unknown): number | null {
  const base = [value, title, description]
    .map((v) => cleanText(v))
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  if (!base) return null
  if (base.includes("studio") || base.includes("bachelor")) return 0
  let m = /(\d+)\s*(?:bed|bedroom|br)\b/.exec(base)
  if (!m) m = /\b(\d+)\s*(?:bd)\b/.exec(base)
  if (!m) return null
  const beds = Number.parseInt(m[1], 10)
  if (!Number.isFinite(beds) || beds < 0 || beds > 10) return null
  return beds
}

function parseBathrooms(value: unknown, title: unknown, description: unknown, url: unknown): number | null {
  const base = [value, title, description, url]
    .map((v) => cleanText(v))
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
  if (!base) return null
  let m = /(\d+(?:\.\d+)?)\s*(?:bath|bathroom|ba)s?\b/.exec(base)
  if (!m) m = /(\d+(?:\.\d+)?)[-_](?:bath|bathroom|ba)s?\b/.exec(base)
  if (!m) return null
  const baths = Number.parseFloat(m[1])
  if (!Number.isFinite(baths) || baths <= 0 || baths > 10) return null
  return baths
}

function hasCivicNumber(address: string): boolean {
  return /^\s*\d{1,5}\s+\S+/.test(address)
}

function normalizeAddress(value: unknown): string | null {
  const text = cleanText(value)
  if (!text) return null
  if (!text.toLowerCase().includes("ottawa")) return `${text}, Ottawa, ON`
  return text
}

function extractNumberedAddress(text: string): string | null {
  const m = NUMBERED_ADDRESS_RE.exec(text)
  return m ? m[1].trim() : null
}

function bestAddressQuery(address: unknown, title: unknown, description: unknown): string | null {
  const direct = normalizeAddress(address)
  if (direct && hasCivicNumber(direct)) return direct
  for (const raw of [title, description, address]) {
    const text = cleanText(raw)
    if (!text) continue
    const extracted = extractNumberedAddress(text)
    if (extracted) return normalizeAddress(extracted)
  }
  return null
}

export function describeNormalizeFailure(raw: KijijiRawListing): string {
  const missing: string[] = []
  if (parseBedrooms(raw.bedrooms_text, raw.title, raw.description) == null) {
    missing.push("bedrooms")
  }
  const hasCoords =
    raw.lat != null &&
    raw.lon != null &&
    Number.isFinite(raw.lat) &&
    Number.isFinite(raw.lon) &&
    inOttawaBbox(raw.lon, raw.lat)
  if (!bestAddressQuery(raw.address, raw.title, raw.description) && !hasCoords) {
    missing.push("Ottawa address")
  }
  if (missing.length > 0) {
    return `Missing ${missing.join(" or ")} — cannot place on map`
  }
  return "Could not place listing on map"
}

export async function normalizeKijijiListing(
  raw: KijijiRawListing,
): Promise<{ lon: number; lat: number; row: Record<string, unknown> } | null> {
  const listingId = extractKijijiId(raw.url)
  if (!listingId) return null

  const parsedPrice = parsePrice(raw.price_text)
  const contactPrice = parsedPrice == null || parsedPrice <= 0

  const beds = parseBedrooms(raw.bedrooms_text, raw.title, raw.description)
  if (beds == null) return null

  const addressQuery = bestAddressQuery(raw.address, raw.title, raw.description)

  let lon: number | null = raw.lon
  let lat: number | null = raw.lat
  let label =
    cleanText(raw.address) ?? addressQuery ?? cleanText(raw.title) ?? "Ottawa listing"

  if (lon == null || lat == null || !inOttawaBbox(lon, lat)) {
    if (!addressQuery) return null
    const geocoded = await geocodeAddress(addressQuery)
    if (!geocoded) return null
    lon = geocoded.lon
    lat = geocoded.lat
    label = geocoded.label
  }

  const title = cleanText(raw.title) ?? label
  const bathrooms = parseBathrooms(
    raw.bathrooms_text,
    title,
    raw.description,
    raw.url,
  )

  const row: Record<string, unknown> = {
    id: `kijiji-${listingId}`,
    title,
    address: label,
    lat,
    lon,
    rent_cad: contactPrice ? 0 : parsedPrice,
    bedrooms: beds,
    source: "kijiji-saved",
    url: raw.url,
    saved: true,
  }
  if (contactPrice || isContactForPrice(raw.price_text)) row.price_contact = true
  if (bathrooms != null) row.bathrooms = bathrooms
  return { lon, lat, row }
}

export function buildSavedKijijiFeature(
  row: Record<string, unknown>,
  score: PointScore,
): Feature<Point> {
  const id = String(row.id)
  const lon = Number(row.lon)
  const lat = Number(row.lat)
  const props: Record<string, unknown> = {
    ...row,
    near_grocery: score.near_grocery,
    near_transit: score.near_transit,
    eligible: score.eligible,
    walk_minutes: score.walk_minutes,
    transit_via: score.transit_via,
    nearest_stop_m: score.nearest_stop_m,
    source: "kijiji-saved",
    saved: true,
  }
  return {
    type: "Feature",
    id,
    properties: props,
    geometry: { type: "Point", coordinates: [lon, lat] },
  }
}

const FETCH_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Accept-Language": "en-CA,en;q=0.9",
}

export async function fetchKijijiListingRaw(url: string): Promise<KijijiRawListing> {
  const canonical = validateKijijiListingUrl(url)
  if (!canonical) {
    return {
      url,
      title: null,
      price_text: null,
      bedrooms_text: null,
      bathrooms_text: null,
      address: null,
      description: null,
      lat: null,
      lon: null,
      error: "invalid_url",
    }
  }

  let response: Response
  try {
    response = await fetch(canonical, {
      headers: FETCH_HEADERS,
      redirect: "follow",
      cache: "no-store",
    })
  } catch {
    return {
      url: canonical,
      title: null,
      price_text: null,
      bedrooms_text: null,
      bathrooms_text: null,
      address: null,
      description: null,
      lat: null,
      lon: null,
      error: "fetch_failed",
    }
  }

  if (response.status === 404 || response.status === 410) {
    return {
      url: canonical,
      title: null,
      price_text: null,
      bedrooms_text: null,
      bathrooms_text: null,
      address: null,
      description: null,
      lat: null,
      lon: null,
      error: "listing_not_found",
    }
  }

  const finalUrl = response.url.toLowerCase()
  if (finalUrl.includes("/deleted")) {
    return {
      url: canonical,
      title: null,
      price_text: null,
      bedrooms_text: null,
      bathrooms_text: null,
      address: null,
      description: null,
      lat: null,
      lon: null,
      error: "listing_deleted",
    }
  }

  if (!response.ok) {
    return {
      url: canonical,
      title: null,
      price_text: null,
      bedrooms_text: null,
      bathrooms_text: null,
      address: null,
      description: null,
      lat: null,
      lon: null,
      error: `http_${response.status}`,
    }
  }

  const html = await response.text()
  const raw = parseListingRawFromHtml(html, canonical)
  if (!raw.title && !raw.price_text) raw.error = "parse_failed"
  return raw
}

export function parseImportUrls(text: string, max = 3): string[] {
  const lines = text
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean)
  const out: string[] = []
  const seen = new Set<string>()
  for (const line of lines) {
    const canonical = validateKijijiListingUrl(line)
    if (!canonical) continue
    const id = extractKijijiId(canonical)
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(canonical)
    if (out.length >= max) break
  }
  return out
}
