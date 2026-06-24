import { isCustomListing, isSavedKijijiListing } from "@/lib/custom-listing"
import type { WalkMinutes } from "@/lib/score-point"

export interface ListingFilterState {
  walkableOnly: boolean
  walkMinutes: WalkMinutes
  maxRent: number
  beds: string[]
}

export interface ListingLayerState {
  staticListings: boolean
  kijijiListings: boolean
}

function passesSourceToggles(
  source: unknown,
  layers: ListingLayerState,
): boolean {
  if (isCustomListing(source)) return true
  if (isSavedKijijiListing(source)) return layers.kijijiListings
  const isKijiji = String(source ?? "").toLowerCase() === "kijiji"
  return (layers.kijijiListings && isKijiji) || (layers.staticListings && !isKijiji)
}

function passesRentAndBedFilters(
  properties: Record<string, unknown>,
  filters: ListingFilterState,
): boolean {
  if (isCustomListing(properties.source)) return true

  if (filters.maxRent < 3500 && Number(properties.rent_cad) > filters.maxRent) {
    return false
  }

  const selectedBeds =
    Array.isArray(filters.beds) && filters.beds.length > 0 ? filters.beds : ["any"]
  if (!selectedBeds.includes("any")) {
    const beds = Number(properties.bedrooms)
    const bedMatch = selectedBeds.some((bed) => {
      if (bed === "3") return beds >= 3
      return beds === Number.parseInt(bed, 10)
    })
    if (!bedMatch) return false
  }

  return true
}

export function passesListingFilters(
  properties: Record<string, unknown>,
  filters: ListingFilterState,
  layers: ListingLayerState,
): boolean {
  if (!passesSourceToggles(properties.source, layers)) return false
  if (filters.walkableOnly && !properties.eligible) return false
  return passesRentAndBedFilters(properties, filters)
}

/** Mapbox GL filter for listings-symbol layer */
export function buildListingMapFilter(
  filters: ListingFilterState,
  layers: ListingLayerState,
): unknown {
  const exprs: unknown[] = ["all"]

  const showStatic = layers.staticListings
  const showKijiji = layers.kijijiListings

  if (!showStatic && !showKijiji) {
    exprs.push([
      "any",
      ["==", ["get", "source"], "custom"],
      ["==", ["get", "source"], "kijiji-saved"],
    ])
  } else if (showStatic && !showKijiji) {
    exprs.push([
      "all",
      ["!=", ["get", "source"], "kijiji"],
      ["!=", ["get", "source"], "kijiji-saved"],
    ])
  } else if (!showStatic && showKijiji) {
    exprs.push([
      "any",
      ["==", ["get", "source"], "kijiji"],
      ["==", ["get", "source"], "kijiji-saved"],
      ["==", ["get", "source"], "custom"],
    ])
  }

  if (filters.walkableOnly) {
    exprs.push(["==", ["get", "eligible"], true])
  }

  if (filters.maxRent < 3500) {
    exprs.push([
      "any",
      ["==", ["get", "source"], "custom"],
      ["<=", ["get", "rent_cad"], filters.maxRent],
    ])
  }

  const selectedBeds =
    Array.isArray(filters.beds) && filters.beds.length > 0 ? filters.beds : ["any"]
  if (!selectedBeds.includes("any")) {
    const clauses = selectedBeds.map((bed) => {
      if (bed === "3") return ([">=", ["get", "bedrooms"], 3] as const)
      return (["==", ["get", "bedrooms"], Number.parseInt(bed, 10)] as const)
    })
    const bedClause =
      clauses.length === 1 ? clauses[0] : (["any", ...clauses] as const)
    exprs.push(["any", ["==", ["get", "source"], "custom"], bedClause])
  }

  return exprs.length === 1 ? true : exprs
}

export function isListingFeature(properties: Record<string, unknown>): boolean {
  if (isCustomListing(properties.source)) return true
  return properties.rent_cad != null
}
