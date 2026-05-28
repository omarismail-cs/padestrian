"use client"

import { useRef, useCallback, useState, useEffect } from "react"
import Map, { NavigationControl, Popup, Source, Layer, type MapRef } from "react-map-gl/mapbox"
import type { MapLayerMouseEvent } from "react-map-gl/mapbox"
import type { GeoJSON } from "geojson"
import "mapbox-gl/dist/mapbox-gl.css"

const CENTER = { longitude: -75.6972, latitude: 45.4215 }
const ZOOM   = 12.5

// Map layer colours — distinct from listing house icons
const LAYER_GROCERY_COLOR = "#14b8a6"  // teal  — grocery store pins
const LAYER_TRANSIT_COLOR = "#0ea5e9"  // sky   — transit stop pins
const LAYER_SMOKE_TRANSIT = "#8b5cf6"  // violet — transit walk zone fill
const LAYER_SMOKE_GROCERY = "#84cc16"  // lime   — grocery walk zone fill

// Pre-tinted house PNGs (same approach as teal grocery-icon.png)
const HOUSE_ICONS = [
  { id: "house-walkable", url: "/images/house-walkable.png" },
  { id: "house-grocery", url: "/images/house-grocery.png" },
  { id: "house-transit", url: "/images/house-transit.png" },
  { id: "house-neither", url: "/images/house-neither.png" },
  { id: "house-default", url: "/images/house-default.png" },
] as const

interface Filters {
  walkableOnly: boolean
  maxRent: number
  beds: string[]
}

interface LayerVisibility {
  groceries: boolean
  transit: boolean
  smoke: boolean
  staticListings: boolean
  kijijiListings: boolean
}

interface PopupInfo {
  longitude: number
  latitude: number
  properties: Record<string, unknown>
  layerId: string
}

interface MapViewProps {
  filters: Filters
  layers: LayerVisibility
  onStatsUpdate: (total: number, walkable: number) => void
  theme: "light" | "dark"
}

export function MapView({ filters, layers, onStatsUpdate, theme }: MapViewProps) {
  const mapRef = useRef<MapRef>(null)
  const [popupInfo, setPopupInfo]   = useState<PopupInfo | null>(null)
  const [cursor,    setCursor]      = useState<string>("auto")

  // Real GeoJSON data
  const [listings,  setListings]  = useState<GeoJSON.FeatureCollection | null>(null)
  const [groceries, setGroceries] = useState<GeoJSON.FeatureCollection | null>(null)
  const [stops,     setStops]     = useState<GeoJSON.FeatureCollection | null>(null)
  const [smokeData, setSmokeData] = useState<GeoJSON.FeatureCollection | null>(null)
  const [hasScores, setHasScores] = useState(false)
  const [groceryIconReady, setGroceryIconReady] = useState(false)
  const [houseIconReady, setHouseIconReady] = useState(false)

  const loadMapIcons = useCallback(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const loadIcon = (
      id: string,
      url: string,
      onReady: () => void,
    ) => {
      if (map.hasImage(id)) {
        onReady()
        return
      }
      map.loadImage(url, (err, image) => {
        if (err || !image) {
          console.warn(`${id} failed to load`, err)
        } else if (!map.hasImage(id)) {
          map.addImage(id, image, { pixelRatio: 2 })
        }
        onReady()
      })
    }

    loadIcon("grocery-icon", "/images/grocery-icon.png", () => setGroceryIconReady(true))

    let houseLoaded = 0
    const onHouseIconReady = () => {
      houseLoaded += 1
      if (houseLoaded >= HOUSE_ICONS.length) setHouseIconReady(true)
    }
    for (const { id, url } of HOUSE_ICONS) {
      loadIcon(id, url, onHouseIconReady)
    }
  }, [])

  // Load core data on mount
  useEffect(() => {
    // Listings: prefer scored, fall back to unscored
    fetch("/data/listings-scored.geojson")
      .then(r => r.ok ? r.json() : Promise.reject())
      .catch(() => fetch("/data/listings.geojson").then(r => r.json()))
      .then((d: GeoJSON.FeatureCollection) => {
        setListings(d)
        const props = d.features[0]?.properties
        setHasScores(
          d.features.length > 0 &&
          props != null &&
          ("near_grocery" in props || "near_transit" in props),
        )
      })
      .catch(() => console.warn("No listings data found"))

    fetch("/data/groceries-points.geojson")
      .then(r => r.json())
      .then(setGroceries)
      .catch(() => console.warn("No groceries data found"))

    fetch("/data/isochrones/smoke.geojson")
      .then(r => r.json())
      .then(setSmokeData)
      .catch(() => console.warn("No smoke data found"))
  }, [])

  // Lazy-load transit stops when that layer is turned on
  useEffect(() => {
    if (layers.transit && !stops) {
      fetch("/data/stops.geojson")
        .then(r => r.json())
        .then(setStops)
        .catch(() => console.warn("No stops data found"))
    }
  }, [layers.transit, stops])

  // Build Mapbox GL filter expression from UI filter state
  const listingFilter = useCallback(() => {
    const exprs: unknown[] = ["all"]

    const showStatic = layers.staticListings
    const showKijiji = layers.kijijiListings
    if (!showStatic && !showKijiji) {
      return ["==", 1, 0]
    }
    if (showStatic && !showKijiji) {
      exprs.push(["!=", ["get", "source"], "kijiji"])
    }
    if (!showStatic && showKijiji) {
      exprs.push(["==", ["get", "source"], "kijiji"])
    }

    if (filters.walkableOnly) {
      exprs.push(["==", ["get", "eligible"], true])
    }

    if (filters.maxRent < 3500) {
      exprs.push(["<=", ["get", "rent_cad"], filters.maxRent])
    }

    const selectedBeds = Array.isArray(filters.beds) && filters.beds.length > 0
      ? filters.beds
      : ["any"]
    if (!selectedBeds.includes("any")) {
      const clauses = selectedBeds.map((bed) => {
        if (bed === "3") return ([">=", ["get", "bedrooms"], 3] as const)
        return (["==", ["get", "bedrooms"], Number.parseInt(bed, 10)] as const)
      })
      if (clauses.length === 1) {
        exprs.push(clauses[0])
      } else {
        exprs.push(["any", ...clauses])
      }
    }

    return exprs.length === 1 ? true : exprs
  }, [filters, layers.staticListings, layers.kijijiListings])

  const passesSourceToggles = useCallback((source: unknown) => {
    const isKijiji = String(source ?? "").toLowerCase() === "kijiji"
    return (layers.kijijiListings && isKijiji) || (layers.staticListings && !isKijiji)
  }, [layers.kijijiListings, layers.staticListings])

  // Recompute stats from raw data (not rendered features) so they're always accurate
  useEffect(() => {
    if (!listings) return
    const features = listings.features.filter((f) => {
      const p = f.properties ?? {}
      if (!passesSourceToggles(p.source)) return false
      if (filters.walkableOnly && !p.eligible) return false
      if (filters.maxRent < 3500 && Number(p.rent_cad) > filters.maxRent) return false
      const selectedBeds = Array.isArray(filters.beds) && filters.beds.length > 0
        ? filters.beds
        : ["any"]
      if (!selectedBeds.includes("any")) {
        const beds = Number(p.bedrooms)
        const bedMatch = selectedBeds.some((bed) => {
          if (bed === "3") return beds >= 3
          return beds === Number.parseInt(bed, 10)
        })
        if (!bedMatch) return false
      }
      return true
    })
    const total = features.length
    const walkable = features.filter(f => f.properties?.eligible).length
    onStatsUpdate(total, walkable)
  }, [filters, listings, onStatsUpdate, passesSourceToggles])

  const listingIconImage = useCallback((): mapboxgl.DataDrivenPropertyValueSpecification<string> => {
    if (!hasScores) return "house-default"
    return [
      "case",
      ["==", ["get", "eligible"], true], "house-walkable",
      ["==", ["get", "near_grocery"], true], "house-grocery",
      ["==", ["get", "near_transit"], true], "house-transit",
      "house-neither",
    ]
  }, [hasScores])

  const handleMouseMove = useCallback((event: MapLayerMouseEvent) => {
    const feature =
      event.features?.find((f) => f.layer?.id === "listings-symbol") ??
      event.features?.find((f) => f.properties?.rent_cad != null) ??
      event.features?.[0]
    if (!feature) {
      setCursor("auto")
      setPopupInfo(null)
      return
    }

    let longitude = event.lngLat.lng
    let latitude = event.lngLat.lat
    const geom = feature.geometry
    if (geom?.type === "Point" && Array.isArray(geom.coordinates)) {
      const [lng, lat] = geom.coordinates
      if (Number.isFinite(lng) && Number.isFinite(lat)) {
        longitude = lng
        latitude = lat
      }
    }
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) {
      setPopupInfo(null)
      return
    }

    setCursor("pointer")
    setPopupInfo({
      longitude,
      latitude,
      properties: feature.properties || {},
      layerId: feature.layer?.id || "",
    })
  }, [])

  const handleMouseLeave = useCallback(() => {
    setCursor("auto")
    setPopupInfo(null)
  }, [])

  const formatPopup = (info: PopupInfo) => {
    const p = info.properties

    if (p.rent_cad != null) {
      const beds = Number(p.bedrooms) === 0
        ? "Studio"
        : `${p.bedrooms} bed${Number(p.bedrooms) === 1 ? "" : "s"}`
      const rent = Number(p.rent_cad).toLocaleString()

      let badge = ""
      if (p.eligible)          badge = "walkable"
      else if (p.near_grocery) badge = "grocery"
      else if (p.near_transit) badge = "transit"
      else                     badge = "neither"

      const badgeClass =
        badge === "walkable" ? "bg-[#6BBF91]/20 text-[#6BBF91]" :
        badge === "grocery"  ? "bg-lime-500/20 text-lime-500" :
        badge === "transit"  ? "bg-violet-500/20 text-violet-400" :
        "bg-muted text-muted-foreground"

      const badgeLabel =
        badge === "walkable" ? "Walkable ✓" :
        badge === "grocery"  ? "Grocery only" :
        badge === "transit"  ? "Transit only" : "Not walkable"

      return (
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="font-semibold text-foreground leading-tight">
              {String(p.title || p.address || "Listing")}
            </span>
            {hasScores ? (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${badgeClass}`}>
                {badgeLabel}
              </span>
            ) : null}
          </div>
          <p className="text-muted-foreground text-sm">${rent}/mo · {beds}</p>
          {p.neighborhood && <p className="text-muted-foreground text-xs">{String(p.neighborhood)}</p>}
          {p.address && p.title && <p className="text-muted-foreground text-xs">{String(p.address)}</p>}
        </div>
      )
    }

    if (info.layerId.includes("smoke") || p.role === "transit_zone" || p.role === "grocery_zone") {
      const mins = p.walk_minutes != null ? `${p.walk_minutes} min walk` : "Walk zone"
      return (
        <div>
          <p className="font-semibold text-foreground">{String(p.label || p.role || "Zone")}</p>
          <p className="text-muted-foreground text-xs">{mins}</p>
        </div>
      )
    }

    if (p.role === "center" || p.label) {
      return (
        <div>
          <p className="font-semibold text-foreground">{String(p.label || "")}</p>
          {p.walk_minutes != null && (
            <p className="text-muted-foreground text-xs">{p.walk_minutes} min walk</p>
          )}
        </div>
      )
    }

    if (p.stop_name) {
      return (
        <div>
          <p className="font-semibold text-foreground">{String(p.stop_name)}</p>
          {p.stop_id && <p className="text-muted-foreground text-xs">Stop {String(p.stop_id)}</p>}
        </div>
      )
    }

    if (p.name) {
      return (
        <div>
          <p className="font-semibold text-foreground">{String(p.name)}</p>
          {p.shop && <p className="text-muted-foreground text-xs capitalize">{String(p.shop)}</p>}
        </div>
      )
    }

    return <p className="text-foreground text-sm">No details</p>
  }

  return (
    <Map
      key={theme}
      ref={mapRef}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ ...CENTER, zoom: ZOOM }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={theme === "dark"
        ? "mapbox://styles/mapbox/dark-v11"
        : "mapbox://styles/mapbox/light-v11"}
      interactiveLayerIds={[
        "listings-symbol",
        "groceries-symbol",
        "stops-circle",
        "smoke-centers",
        "smoke-zones-fill",
      ]}
      cursor={cursor}
      onLoad={loadMapIcons}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <NavigationControl position="bottom-right" />

      {/* ── Listings (pre-colored house icons, same pattern as groceries) ── */}
      {listings && houseIconReady && (
        <Source id="listings" type="geojson" data={listings}>
          <Layer
            id="listings-symbol"
            type="symbol"
            filter={listingFilter() as mapboxgl.FilterSpecification}
            layout={{
              "icon-image": listingIconImage(),
              "icon-size": [
                "interpolate", ["linear"], ["zoom"],
                10, 0.55,
                14, 0.85,
                18, 1.1,
              ],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            }}
          />
        </Source>
      )}

      {/* ── Groceries (custom store icon) ─────────────────────────── */}
      {groceries && layers.groceries && groceryIconReady && (
        <Source id="groceries" type="geojson" data={groceries}>
          <Layer
            id="groceries-symbol"
            type="symbol"
            layout={{
              "icon-image": "grocery-icon",
              "icon-size": [
                "interpolate", ["linear"], ["zoom"],
                10, 0.55,
                14, 0.85,
                18, 1.1,
              ],
              "icon-allow-overlap": true,
              "icon-ignore-placement": true,
            }}
          />
        </Source>
      )}

      {/* ── Transit stops — individual dots, visible only when zoomed in ── */}
      {stops && layers.transit && (
        <Source id="stops" type="geojson" data={stops}>
          <Layer
            id="stops-circle"
            type="circle"
            minzoom={11}
            paint={{
              "circle-radius": [
                "interpolate", ["linear"], ["zoom"],
                11, 2.2,
                13, 2.8,
                16, 3.4,
              ],
              "circle-color": LAYER_TRANSIT_COLOR,
              "circle-stroke-width": 0,
              "circle-opacity": 1,
            }}
          />
        </Source>
      )}

      {/* ── Smoke / walk zones ───────────────────────────────────── */}
      {smokeData && layers.smoke && (
        <Source id="smoke" type="geojson" data={smokeData}>
          <Layer
            id="smoke-zones-fill"
            type="fill"
            filter={["in", ["get", "role"], ["literal", ["transit_zone", "grocery_zone"]]]}
            paint={{
              "fill-color": [
                "match", ["get", "role"],
                "transit_zone", LAYER_SMOKE_TRANSIT,
                "grocery_zone", LAYER_SMOKE_GROCERY,
                "#94a3b8",
              ],
              "fill-opacity": 0.15,
            }}
          />
          <Layer
            id="smoke-zones-outline"
            type="line"
            filter={["in", ["get", "role"], ["literal", ["transit_zone", "grocery_zone"]]]}
            paint={{
              "line-width": 1.5,
              "line-color": ["match", ["get", "role"],
                "transit_zone", LAYER_SMOKE_TRANSIT,
                LAYER_SMOKE_GROCERY,
              ],
              "line-opacity": 0.6,
            }}
          />
          <Layer
            id="smoke-centers"
            type="circle"
            filter={["==", ["get", "role"], "center"]}
            paint={{
              "circle-radius": 5,
              "circle-color": ["match", ["get", "kind"],
                "transit", LAYER_SMOKE_TRANSIT,
                LAYER_SMOKE_GROCERY,
              ],
              "circle-stroke-width": 2,
              "circle-stroke-color": "rgba(0,0,0,0.2)",
            }}
          />
        </Source>
      )}

      {/* ── Popup ─────────────────────────────────────────────────── */}
      {popupInfo &&
        Number.isFinite(popupInfo.longitude) &&
        Number.isFinite(popupInfo.latitude) && (
        <Popup
          longitude={popupInfo.longitude}
          latitude={popupInfo.latitude}
          anchor="bottom"
          onClose={() => setPopupInfo(null)}
          closeButton={false}
          closeOnClick={false}
          offset={12}
        >
          {formatPopup(popupInfo)}
        </Popup>
      )}
    </Map>
  )
}
