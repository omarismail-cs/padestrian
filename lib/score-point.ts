import booleanPointInPolygon from "@turf/boolean-point-in-polygon"
import { point } from "@turf/helpers"
import type {
  Feature,
  FeatureCollection,
  Geometry,
  Polygon,
  MultiPolygon,
} from "geojson"

const DEFAULT_WALK_MINUTES = 10
const METERS_PER_MINUTE = 5000 / 60
const DETOUR_FACTOR = 1.35

export type WalkMinutes = 10 | 15 | 20

export const WALK_MINUTE_OPTIONS: WalkMinutes[] = [10, 15, 20]

export interface PointScore {
  near_grocery: boolean
  near_transit: boolean
  eligible: boolean
  walk_minutes: number
  transit_via: "zone" | "nearest_stop" | "none"
  nearest_stop_m?: number
  grocery_zone_source: string
  transit_zone_source: string
}

export class ScoringDataError extends Error {
  constructor(message: string) {
    super(message)
    this.name = "ScoringDataError"
  }
}

type PolyFeature = Feature<Polygon | MultiPolygon>

type ZoneCacheEntry = { polys: PolyFeature[]; source: string }

const groceryPolysCache = new Map<number, ZoneCacheEntry>()
const transitPolysCache = new Map<number, ZoneCacheEntry>()
let stopsCache: Array<[number, number]> | null = null

export function minuteTag(minutes: number): string {
  if (minutes === Math.floor(minutes)) return `${Math.floor(minutes)}min`
  return `${minutes}min`.replace(".", "p")
}

function walkThresholdMeters(minutes: number): number {
  return minutes * METERS_PER_MINUTE * DETOUR_FACTOR
}

function haversineMeters(lon1: number, lat1: number, lon2: number, lat2: number): number {
  const r = 6_371_000
  const p = Math.PI / 180
  const dlat = (lat2 - lat1) * p
  const dlon = (lon2 - lon1) * p
  const a =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(lat1 * p) * Math.cos(lat2 * p) * Math.sin(dlon / 2) ** 2
  return 2 * r * Math.asin(Math.sqrt(a))
}

async function readPublicGeoJson(relativePath: string): Promise<FeatureCollection | null> {
  if (typeof window !== "undefined") return null
  try {
    const { readFile } = await import("node:fs/promises")
    const { join } = await import("node:path")
    const filePath = join(process.cwd(), "public", relativePath.replace(/^\//, ""))
    const raw = await readFile(filePath, "utf-8")
    return JSON.parse(raw) as FeatureCollection
  } catch {
    return null
  }
}

function resolveFetchUrl(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url
  if (typeof window !== "undefined") return url
  const base =
    process.env.VERCEL_URL != null
      ? `https://${process.env.VERCEL_URL}`
      : `http://localhost:${process.env.PORT ?? "3000"}`
  return `${base}${url}`
}

async function fetchGeoJson(url: string): Promise<FeatureCollection | null> {
  if (url.startsWith("/data/")) {
    const fromDisk = await readPublicGeoJson(url)
    if (fromDisk) return fromDisk
  }

  try {
    const resp = await fetch(resolveFetchUrl(url))
    if (!resp.ok) return null
    return (await resp.json()) as FeatureCollection
  } catch {
    return null
  }
}

function polygonsFromCollection(
  fc: FeatureCollection,
  roles: Set<string>,
): PolyFeature[] {
  const polys: PolyFeature[] = []
  for (const feature of fc.features) {
    const role = feature.properties?.role
    if (typeof role !== "string" || !roles.has(role)) continue
    const geom = feature.geometry
    if (geom?.type === "Polygon" || geom?.type === "MultiPolygon") {
      polys.push(feature as PolyFeature)
    }
  }
  return polys
}

function pointInAny(lon: number, lat: number, polygons: PolyFeature[]): boolean {
  if (polygons.length === 0) return false
  const pt = point([lon, lat])
  return polygons.some((poly) => booleanPointInPolygon(pt, poly as Feature<Geometry>))
}

async function resolveZonePolygons(
  kind: "grocery" | "transit",
  minutes: number,
  smokeRole: string,
): Promise<ZoneCacheEntry> {
  const tag = minuteTag(minutes)
  const mergedUrl = `/data/zones/${kind}-${tag}.geojson`
  const merged = await fetchGeoJson(mergedUrl)
  if (merged) {
    const zoneRole = `${kind}_zone`
    const polys = polygonsFromCollection(merged, new Set([zoneRole]))
    if (polys.length > 0) {
      return { polys, source: `${kind}-${tag}.geojson` }
    }
  }

  if (minutes !== DEFAULT_WALK_MINUTES) {
    const fallbackTag = minuteTag(DEFAULT_WALK_MINUTES)
    const fallbackUrl = `/data/zones/${kind}-${fallbackTag}.geojson`
    const fallback = await fetchGeoJson(fallbackUrl)
    if (fallback) {
      const zoneRole = `${kind}_zone`
      const polys = polygonsFromCollection(fallback, new Set([zoneRole]))
      if (polys.length > 0) {
        console.warn(
          `[score-point] Missing ${kind} zones for ${minutes} min; falling back to ${DEFAULT_WALK_MINUTES} min polygons.`,
        )
        return { polys, source: `${kind}-${fallbackTag}.geojson (fallback)` }
      }
    }
  }

  const smoke = await fetchGeoJson("/data/isochrones/smoke.geojson")
  if (smoke) {
    const polys = polygonsFromCollection(smoke, new Set([smokeRole]))
    if (polys.length > 0) {
      return { polys, source: "smoke.geojson (fallback)" }
    }
  }

  return { polys: [], source: "none" }
}

async function loadStops(): Promise<Array<[number, number]>> {
  if (stopsCache) return stopsCache
  const fc = await fetchGeoJson("/data/stops.geojson")
  const coords: Array<[number, number]> = []
  if (fc) {
    for (const feat of fc.features) {
      if (feat.geometry?.type !== "Point") continue
      const c = feat.geometry.coordinates
      if (c && c.length >= 2) {
        coords.push([Number(c[0]), Number(c[1])])
      }
    }
  }
  stopsCache = coords
  return coords
}

function nearestStopMeters(
  lon: number,
  lat: number,
  stops: Array<[number, number]>,
): number | null {
  if (stops.length === 0) return null
  let best = Infinity
  for (const [slon, slat] of stops) {
    const d = haversineMeters(lon, lat, slon, slat)
    if (d < best) best = d
  }
  return best === Infinity ? null : best
}

function scoreNearTransit(
  lon: number,
  lat: number,
  inTransitZone: boolean,
  stops: Array<[number, number]>,
  minutes: number,
): { near: boolean; via: "zone" | "nearest_stop" | "none"; nearestM?: number } {
  if (inTransitZone) {
    return { near: true, via: "zone" }
  }
  const threshold = walkThresholdMeters(minutes)
  const dist = nearestStopMeters(lon, lat, stops)
  if (dist != null && dist <= threshold) {
    return { near: true, via: "nearest_stop", nearestM: dist }
  }
  return { near: false, via: "none", nearestM: dist ?? undefined }
}

function scorePointSync(
  lon: number,
  lat: number,
  minutes: number,
  groceryEntry: ZoneCacheEntry,
  transitEntry: ZoneCacheEntry,
  stops: Array<[number, number]>,
): PointScore {
  const nearGrocery = pointInAny(lon, lat, groceryEntry.polys)
  const inTransitZone = pointInAny(lon, lat, transitEntry.polys)
  const transit = scoreNearTransit(lon, lat, inTransitZone, stops, minutes)
  const eligible = nearGrocery && transit.near

  return {
    near_grocery: nearGrocery,
    near_transit: transit.near,
    eligible,
    walk_minutes: minutes,
    transit_via: transit.via,
    nearest_stop_m:
      transit.nearestM != null ? Math.round(transit.nearestM) : undefined,
    grocery_zone_source: groceryEntry.source,
    transit_zone_source: transitEntry.source,
  }
}

async function ensureZoneCaches(minutes: number): Promise<{
  grocery: ZoneCacheEntry
  transit: ZoneCacheEntry
  stops: Array<[number, number]>
}> {
  if (!groceryPolysCache.has(minutes)) {
    groceryPolysCache.set(
      minutes,
      await resolveZonePolygons("grocery", minutes, "grocery_zone"),
    )
  }
  if (!transitPolysCache.has(minutes)) {
    transitPolysCache.set(
      minutes,
      await resolveZonePolygons("transit", minutes, "transit_zone"),
    )
  }

  const grocery = groceryPolysCache.get(minutes)!
  const transit = transitPolysCache.get(minutes)!

  if (grocery.polys.length === 0) {
    throw new ScoringDataError(
      "Grocery walk zones are not available. Run the data pipeline (build-zones) and deploy zone GeoJSON to /data.",
    )
  }

  const stops = await loadStops()
  return { grocery, transit, stops }
}

export async function preloadScoringData(minutes: number): Promise<void> {
  await ensureZoneCaches(minutes)
}

export async function fetchWalkZoneLayers(
  minutes: number,
): Promise<FeatureCollection> {
  const tag = minuteTag(minutes)
  const fallbackTag = minuteTag(DEFAULT_WALK_MINUTES)

  async function loadKind(kind: "grocery" | "transit"): Promise<FeatureCollection["features"]> {
    const primary = await fetchGeoJson(`/data/zones/${kind}-${tag}.geojson`)
    if (primary?.features?.length) return primary.features

    if (minutes !== DEFAULT_WALK_MINUTES) {
      const fallback = await fetchGeoJson(`/data/zones/${kind}-${fallbackTag}.geojson`)
      if (fallback?.features?.length) return fallback.features
    }
    return []
  }

  const [groceryFeatures, transitFeatures] = await Promise.all([
    loadKind("grocery"),
    loadKind("transit"),
  ])

  const features = [...groceryFeatures, ...transitFeatures]
  if (features.length > 0) {
    return { type: "FeatureCollection", features }
  }

  const smoke = await fetchGeoJson("/data/isochrones/smoke.geojson")
  if (smoke?.features?.length) {
    return smoke
  }

  return { type: "FeatureCollection", features: [] }
}

export async function rescoreFeatureCollection(
  fc: FeatureCollection,
  minutes: number,
): Promise<FeatureCollection> {
  const { grocery, transit, stops } = await ensureZoneCaches(minutes)

  const features = fc.features.map((feature) => {
    if (feature.geometry?.type !== "Point") return feature
    const coords = feature.geometry.coordinates
    if (!coords || coords.length < 2) return feature

    const lon = Number(coords[0])
    const lat = Number(coords[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return feature

    const score = scorePointSync(lon, lat, minutes, grocery, transit, stops)
    return {
      ...feature,
      properties: {
        ...feature.properties,
        near_grocery: score.near_grocery,
        near_transit: score.near_transit,
        eligible: score.eligible,
        walk_minutes: score.walk_minutes,
        transit_via: score.transit_via,
        nearest_stop_m: score.nearest_stop_m,
        grocery_zone_source: score.grocery_zone_source,
        transit_zone_source: score.transit_zone_source,
      },
    }
  })

  return { type: "FeatureCollection", features }
}

export async function scorePoint(
  lon: number,
  lat: number,
  minutes = DEFAULT_WALK_MINUTES,
): Promise<PointScore> {
  const { grocery, transit, stops } = await ensureZoneCaches(minutes)
  return scorePointSync(lon, lat, minutes, grocery, transit, stops)
}
