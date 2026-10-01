import type { FeatureCollection, Point } from "geojson"
import {
  passesListingFilters,
  type ListingFilterState,
  type ListingLayerState,
} from "@/lib/listing-filters"

export interface KijijiListItem {
  id: string
  address: string
  rent_cad: number
  bedrooms: number
  eligible: boolean
  near_grocery: boolean
  near_transit: boolean
  lon: number
  lat: number
  properties: Record<string, unknown>
  visibleOnMap: boolean
  hiddenReason: "layer" | "filters" | null
}

function isKijijiListing(source: unknown, id?: unknown): boolean {
  if (String(source ?? "").toLowerCase() === "kijiji") return true
  const sid = String(id ?? "")
  return sid.startsWith("kijiji-")
}

export function formatListAddress(address: string): string {
  const trimmed = address.trim()
  if (!trimmed) return "Unknown address"
  const first = trimmed.split(",")[0]?.trim()
  return first || trimmed
}

export function buildKijijiListItems(
  fc: FeatureCollection | null,
  filters: ListingFilterState,
  layers: ListingLayerState,
): KijijiListItem[] {
  if (!fc?.features?.length) return []

  const items: KijijiListItem[] = []

  for (const feature of fc.features) {
    const p = feature.properties ?? {}
    const fid = String(feature.id ?? p.id ?? "")
    if (!isKijijiListing(p.source, fid)) continue

    const geom = feature.geometry
    if (geom?.type !== "Point" || !geom.coordinates || geom.coordinates.length < 2) {
      continue
    }

    const lon = Number(geom.coordinates[0])
    const lat = Number(geom.coordinates[1])
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue

    const passesFilters = passesListingFilters(p, filters, layers)
    let hiddenReason: KijijiListItem["hiddenReason"] = null
    let visibleOnMap = passesFilters

    if (!layers.kijijiListings) {
      visibleOnMap = false
      hiddenReason = "layer"
    } else if (!passesFilters) {
      visibleOnMap = false
      hiddenReason = "filters"
    }

    items.push({
      id: fid || `kijiji-${items.length}`,
      address: String(p.address || p.title || "").trim(),
      rent_cad: Number(p.rent_cad) || 0,
      bedrooms: Number(p.bedrooms) || 0,
      eligible: Boolean(p.eligible),
      near_grocery: Boolean(p.near_grocery),
      near_transit: Boolean(p.near_transit),
      lon,
      lat,
      properties: { ...p },
      visibleOnMap,
      hiddenReason,
    })
  }

  return items
}

export type KijijiListSort = "walkable" | "rent-asc" | "rent-desc" | "newest"

function kijijiIdRank(id: string): number {
  const match = id.match(/(\d+)$/)
  return match ? Number(match[1]) : 0
}

function compareAddress(a: KijijiListItem, b: KijijiListItem): number {
  return formatListAddress(a.address).localeCompare(formatListAddress(b.address))
}

export function sortKijijiListItems(
  items: KijijiListItem[],
  sort: KijijiListSort,
): KijijiListItem[] {
  const copy = [...items]
  copy.sort((a, b) => {
    if (sort === "rent-asc") {
      if (a.rent_cad !== b.rent_cad) return a.rent_cad - b.rent_cad
      return compareAddress(a, b)
    }
    if (sort === "rent-desc") {
      if (a.rent_cad !== b.rent_cad) return b.rent_cad - a.rent_cad
      return compareAddress(a, b)
    }
    if (sort === "newest") {
      return kijijiIdRank(b.id) - kijijiIdRank(a.id)
    }
    if (a.eligible !== b.eligible) return a.eligible ? -1 : 1
    if (a.rent_cad !== b.rent_cad) return a.rent_cad - b.rent_cad
    return compareAddress(a, b)
  })
  return copy
}

export function kijijiListSummary(items: KijijiListItem[]): {
  total: number
  walkable: number
} {
  return {
    total: items.length,
    walkable: items.filter((i) => i.eligible).length,
  }
}
