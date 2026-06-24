import type { Feature, Point } from "geojson"
import type { GeocodeResult } from "@/lib/geocode"
import type { PointScore } from "@/lib/score-point"

const CUSTOM_LISTING_ID = "custom-address"
const CUSTOM_ADDRESS_STORAGE_KEY = "padestrian:custom-address"
const CUSTOM_ADDRESS_STORAGE_VERSION = 1

interface StoredCustomAddress {
  version: number
  id: string
  address: string
  lon: number
  lat: number
  near_grocery: boolean
  near_transit: boolean
  eligible: boolean
  walk_minutes: number
  transit_via?: string
  nearest_stop_m?: number
}

export function buildCustomListingFeature(
  geocoded: GeocodeResult,
  score: PointScore,
): Feature<Point> {
  return {
    type: "Feature",
    id: CUSTOM_LISTING_ID,
    properties: {
      id: CUSTOM_LISTING_ID,
      title: geocoded.label,
      address: geocoded.label,
      source: "custom",
      near_grocery: score.near_grocery,
      near_transit: score.near_transit,
      eligible: score.eligible,
      walk_minutes: score.walk_minutes,
      transit_via: score.transit_via,
      nearest_stop_m: score.nearest_stop_m,
    },
    geometry: {
      type: "Point",
      coordinates: [geocoded.lon, geocoded.lat],
    },
  }
}

function storedToFeature(stored: StoredCustomAddress): Feature<Point> {
  return {
    type: "Feature",
    id: stored.id,
    properties: {
      id: stored.id,
      title: stored.address,
      address: stored.address,
      source: "custom",
      near_grocery: stored.near_grocery,
      near_transit: stored.near_transit,
      eligible: stored.eligible,
      walk_minutes: stored.walk_minutes,
      transit_via: stored.transit_via,
      nearest_stop_m: stored.nearest_stop_m,
    },
    geometry: {
      type: "Point",
      coordinates: [stored.lon, stored.lat],
    },
  }
}

function featureToStored(feature: Feature<Point>): StoredCustomAddress | null {
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  const p = feature.properties ?? {}
  const address = String(p.address || p.title || "").trim()
  if (!address) return null

  return {
    version: CUSTOM_ADDRESS_STORAGE_VERSION,
    id: CUSTOM_LISTING_ID,
    address,
    lon: Number(coords[0]),
    lat: Number(coords[1]),
    near_grocery: Boolean(p.near_grocery),
    near_transit: Boolean(p.near_transit),
    eligible: Boolean(p.eligible),
    walk_minutes: Number(p.walk_minutes) || 10,
    transit_via: p.transit_via != null ? String(p.transit_via) : undefined,
    nearest_stop_m:
      p.nearest_stop_m != null ? Number(p.nearest_stop_m) : undefined,
  }
}

export function loadCustomAddressFromStorage(): Feature<Point> | null {
  if (typeof window === "undefined") return null
  try {
    const raw = localStorage.getItem(CUSTOM_ADDRESS_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as StoredCustomAddress
    if (parsed.version !== CUSTOM_ADDRESS_STORAGE_VERSION) return null
    if (parsed.id !== CUSTOM_LISTING_ID) return null
    if (!parsed.address || !Number.isFinite(parsed.lon) || !Number.isFinite(parsed.lat)) {
      return null
    }
    return storedToFeature(parsed)
  } catch {
    return null
  }
}

export function saveCustomAddressToStorage(feature: Feature<Point>): void {
  const stored = featureToStored(feature)
  if (!stored) return
  localStorage.setItem(CUSTOM_ADDRESS_STORAGE_KEY, JSON.stringify(stored))
}

export function clearCustomAddressStorage(): void {
  localStorage.removeItem(CUSTOM_ADDRESS_STORAGE_KEY)
}

export function isCustomListing(source: unknown): boolean {
  return String(source ?? "").toLowerCase() === "custom"
}

export function isSavedKijijiListing(source: unknown): boolean {
  return String(source ?? "").toLowerCase() === "kijiji-saved"
}

export function mergeListingsWithCustom(
  base: GeoJSON.FeatureCollection,
  custom: Feature<Point> | null,
): GeoJSON.FeatureCollection {
  const withoutCustom = base.features.filter(
    (f) => !isCustomListing(f.properties?.source),
  )
  if (!custom) {
    return { type: "FeatureCollection", features: withoutCustom }
  }
  return {
    type: "FeatureCollection",
    features: [...withoutCustom, custom],
  }
}

/** Merge personal saved Kijiji imports and optional custom pin onto the catalog. */
export function mergeListingsWithPersonal(
  base: GeoJSON.FeatureCollection,
  savedImports: Feature<Point>[] | undefined,
  custom: Feature<Point> | null,
): GeoJSON.FeatureCollection {
  const saved = savedImports ?? []
  const savedIds = new Set(
    saved.map((f) => String(f.properties?.id ?? f.id ?? "")),
  )

  const catalog = base.features.filter((f) => {
    if (isCustomListing(f.properties?.source)) return false
    if (isSavedKijijiListing(f.properties?.source)) return false
    const fid = String(f.properties?.id ?? f.id ?? "")
    return !savedIds.has(fid)
  })

  const features = [...catalog, ...saved]
  if (custom) features.push(custom)

  return { type: "FeatureCollection", features }
}
