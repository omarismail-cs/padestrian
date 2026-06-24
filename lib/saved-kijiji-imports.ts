import type { Feature, Point } from "geojson"
import type { PointScore } from "@/lib/score-point"

export const SAVED_KIJIJI_STORAGE_KEY = "padestrian:saved-kijiji-imports"
export const SAVED_KIJIJI_STORAGE_VERSION = 1
export const MAX_SAVED_KIJIJI_IMPORTS = 25

export const SAVED_KIJIJI_SOURCE = "kijiji-saved"

interface StoredSavedKijiji {
  version: number
  id: string
  url: string
  title: string
  address: string
  lon: number
  lat: number
  rent_cad: number
  bedrooms: number
  bathrooms?: number
  price_contact?: boolean
  near_grocery: boolean
  near_transit: boolean
  eligible: boolean
  walk_minutes: number
  transit_via?: string
  nearest_stop_m?: number
  imported_at: string
}

export function isSavedKijijiImport(source: unknown): boolean {
  return String(source ?? "").toLowerCase() === SAVED_KIJIJI_SOURCE
}

function featureToStored(feature: Feature<Point>): StoredSavedKijiji | null {
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return null
  const p = feature.properties ?? {}
  const id = String(p.id ?? feature.id ?? "").trim()
  const url = String(p.url ?? "").trim()
  const address = String(p.address || p.title || "").trim()
  if (!id || !url || !address) return null

  const lon = Number(coords[0])
  const lat = Number(coords[1])
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null

  const stored: StoredSavedKijiji = {
    version: SAVED_KIJIJI_STORAGE_VERSION,
    id,
    url,
    title: String(p.title ?? address),
    address,
    lon,
    lat,
    rent_cad: Number(p.rent_cad) || 0,
    bedrooms: Number(p.bedrooms) || 0,
    near_grocery: Boolean(p.near_grocery),
    near_transit: Boolean(p.near_transit),
    eligible: Boolean(p.eligible),
    walk_minutes: Number(p.walk_minutes) || 10,
    imported_at: new Date().toISOString(),
  }
  if (p.bathrooms != null) stored.bathrooms = Number(p.bathrooms)
  if (p.price_contact) stored.price_contact = true
  if (p.transit_via != null) stored.transit_via = String(p.transit_via)
  if (p.nearest_stop_m != null) stored.nearest_stop_m = Number(p.nearest_stop_m)
  return stored
}

function storedToFeature(stored: StoredSavedKijiji): Feature<Point> {
  const props: Record<string, unknown> = {
    id: stored.id,
    title: stored.title,
    address: stored.address,
    rent_cad: stored.rent_cad,
    bedrooms: stored.bedrooms,
    source: SAVED_KIJIJI_SOURCE,
    url: stored.url,
    saved: true,
    near_grocery: stored.near_grocery,
    near_transit: stored.near_transit,
    eligible: stored.eligible,
    walk_minutes: stored.walk_minutes,
    imported_at: stored.imported_at,
  }
  if (stored.bathrooms != null) props.bathrooms = stored.bathrooms
  if (stored.price_contact) props.price_contact = true
  if (stored.transit_via) props.transit_via = stored.transit_via
  if (stored.nearest_stop_m != null) props.nearest_stop_m = stored.nearest_stop_m

  return {
    type: "Feature",
    id: stored.id,
    properties: props,
    geometry: { type: "Point", coordinates: [stored.lon, stored.lat] },
  }
}

export function loadSavedKijijiImportsFromStorage(): Feature<Point>[] {
  if (typeof window === "undefined") return []
  try {
    const raw = localStorage.getItem(SAVED_KIJIJI_STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredSavedKijiji[]
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (row) =>
          row.version === SAVED_KIJIJI_STORAGE_VERSION &&
          row.id &&
          row.url &&
          Number.isFinite(row.lon) &&
          Number.isFinite(row.lat),
      )
      .map(storedToFeature)
  } catch {
    return []
  }
}

function writeStored(rows: StoredSavedKijiji[]): void {
  localStorage.setItem(SAVED_KIJIJI_STORAGE_KEY, JSON.stringify(rows))
}

export function saveSavedKijijiImportsToStorage(features: Feature<Point>[]): void {
  const rows = features
    .map(featureToStored)
    .filter((row): row is StoredSavedKijiji => row != null)
    .slice(0, MAX_SAVED_KIJIJI_IMPORTS)
  writeStored(rows)
}

export function upsertSavedKijijiImport(feature: Feature<Point>): Feature<Point>[] {
  return upsertSavedKijijiImports([feature])
}

export function upsertSavedKijijiImports(features: Feature<Point>[]): Feature<Point>[] {
  const byId = new Map<string, Feature<Point>>()
  for (const feature of loadSavedKijijiImportsFromStorage()) {
    const id = String(feature.properties?.id ?? feature.id ?? "")
    if (id) byId.set(id, feature)
  }
  for (const feature of features) {
    const stored = featureToStored(feature)
    if (!stored) continue
    byId.set(stored.id, storedToFeature(stored))
  }
  const merged = Array.from(byId.values()).slice(0, MAX_SAVED_KIJIJI_IMPORTS)
  saveSavedKijijiImportsToStorage(merged)
  return merged
}

export function removeSavedKijijiImport(id: string): Feature<Point>[] {
  const next = loadSavedKijijiImportsFromStorage().filter(
    (f) => String(f.properties?.id ?? f.id) !== id,
  )
  saveSavedKijijiImportsToStorage(next)
  return next
}

export function applyScoreToSavedFeature(
  feature: Feature<Point>,
  score: PointScore,
): Feature<Point> {
  const coords = feature.geometry?.coordinates
  if (!coords || coords.length < 2) return feature
  const p = feature.properties ?? {}
  return {
    type: "Feature",
    id: feature.id ?? p.id,
    properties: {
      ...p,
      near_grocery: score.near_grocery,
      near_transit: score.near_transit,
      eligible: score.eligible,
      walk_minutes: score.walk_minutes,
      transit_via: score.transit_via,
      nearest_stop_m: score.nearest_stop_m,
      source: SAVED_KIJIJI_SOURCE,
      saved: true,
    },
    geometry: feature.geometry,
  }
}

export function savedKijijiToListItem(feature: Feature<Point>) {
  const p = feature.properties ?? {}
  const coords = feature.geometry?.coordinates ?? []
  return {
    id: String(p.id ?? feature.id ?? ""),
    address: String(p.address || p.title || ""),
    rent_cad: Number(p.rent_cad) || 0,
    bedrooms: Number(p.bedrooms) || 0,
    eligible: Boolean(p.eligible),
    near_grocery: Boolean(p.near_grocery),
    near_transit: Boolean(p.near_transit),
    lon: Number(coords[0]),
    lat: Number(coords[1]),
    properties: { ...p },
    visibleOnMap: true,
    hiddenReason: null as const,
    isSaved: true as const,
  }
}
