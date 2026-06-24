"use client"

import { useRef, useCallback, useState, useEffect, useMemo } from "react"
import Map, { NavigationControl, GeolocateControl, Popup, Source, Layer, type MapRef } from "react-map-gl/mapbox"
import type { MapLayerMouseEvent } from "react-map-gl/mapbox"
import type { GeoJSON, Feature, Point } from "geojson"
import "mapbox-gl/dist/mapbox-gl.css"
import { GroceryPopupCard } from "@/components/map/grocery-popup"
import { ListingPopupCard } from "@/components/map/listing-popup"
import {
  mergeListingsWithPersonal,
  isCustomListing,
} from "@/lib/custom-listing"
import {
  buildListingMapFilter,
  isListingFeature,
  passesListingFilters,
} from "@/lib/listing-filters"
import {
  fetchWalkZoneLayers,
  rescoreFeatureCollection,
  type WalkMinutes,
} from "@/lib/score-point"

const CENTER = { longitude: -75.6972, latitude: 45.4215 }
const ZOOM   = 12.5

const MAP_STYLE = {
  dark: "mapbox://styles/mapbox/dark-v11",
  light: "mapbox://styles/mapbox/light-v11",
} as const

// Map layer colours — distinct from listing house icons
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
  walkMinutes: WalkMinutes
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

export interface MapFocusListing {
  lon: number
  lat: number
  properties: Record<string, unknown>
}

interface MapViewProps {
  filters: Filters
  layers: LayerVisibility
  onStatsUpdate: (total: number, walkable: number) => void
  theme: "light" | "dark"
  customListing: Feature<Point> | null
  savedKijijiImports: Feature<Point>[]
  flyToCustomKey: number
  onListingsChange?: (fc: GeoJSON.FeatureCollection) => void
  focusListing: MapFocusListing | null
  focusListingKey: number
  onLocateMe?: (lon: number, lat: number) => void
}

/** Same as grocery POI popups — scalar offset works with Mapbox anchor-bottom */
const POI_POPUP_OFFSET = 12

export function MapView({
  filters,
  layers,
  onStatsUpdate,
  theme,
  customListing,
  savedKijijiImports,
  flyToCustomKey,
  onListingsChange,
  focusListing,
  focusListingKey,
  onLocateMe,
}: MapViewProps) {
  const mapRef = useRef<MapRef>(null)
  const mapInteractingRef = useRef(false)
  const [popupInfo, setPopupInfo]   = useState<PopupInfo | null>(null)
  const [cursor,    setCursor]      = useState<string>("auto")
  const popupHoverRef = useRef(false)

  const [baseListings, setBaseListings] = useState<GeoJSON.FeatureCollection | null>(null)
  const [listings, setListings] = useState<GeoJSON.FeatureCollection | null>(null)
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
      pixelRatio = 2,
    ) => {
      if (map.hasImage(id)) {
        onReady()
        return
      }
      map.loadImage(url, (err, image) => {
        if (err || !image) {
          console.warn(`${id} failed to load`, err)
        } else if (!map.hasImage(id)) {
          map.addImage(id, image, { pixelRatio })
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

  // mapStyle changes wipe custom images; reload icons then let keyed Sources re-mount
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map) return

    const syncIcons = () => {
      setGroceryIconReady(false)
      setHouseIconReady(false)
      loadMapIcons()
    }

    map.on("style.load", syncIcons)
    // Catch style.load if it finished before this effect ran
    map.once("idle", () => {
      if (!map.hasImage("grocery-icon")) syncIcons()
    })

    return () => {
      map.off("style.load", syncIcons)
    }
  }, [theme, loadMapIcons])

  // Load core data on mount
  useEffect(() => {
    // Listings: live Supabase API, fall back to static GeoJSON
    fetch("/api/listings")
      .then(r => r.ok ? r.json() : Promise.reject())
      .catch(() => fetch("/data/listings-scored.geojson").then(r => r.ok ? r.json() : Promise.reject()))
      .catch(() => fetch("/data/listings.geojson").then(r => r.json()))
      .then((d: GeoJSON.FeatureCollection) => {
        setBaseListings(d)
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
  }, [])

  useEffect(() => {
    if (!layers.smoke) return
    let cancelled = false
    void fetchWalkZoneLayers(filters.walkMinutes).then((data) => {
      if (!cancelled) setSmokeData(data)
    })
    return () => {
      cancelled = true
    }
  }, [layers.smoke, filters.walkMinutes])

  // Lazy-load transit stops when that layer is turned on
  useEffect(() => {
    if (layers.transit && !stops) {
      fetch("/data/stops.geojson")
        .then(r => r.json())
        .then(setStops)
        .catch(() => console.warn("No stops data found"))
    }
  }, [layers.transit, stops])

  useEffect(() => {
    if (!baseListings) return
    let cancelled = false

    void (async () => {
      let fc = baseListings
      if (filters.walkMinutes !== 10) {
        fc = await rescoreFeatureCollection(baseListings, filters.walkMinutes)
      }
      if (cancelled) return
      const merged = mergeListingsWithPersonal(fc, savedKijijiImports, customListing)
      setListings(merged)
      const anyScores = merged.features.some((f) => {
        const p = f.properties
        return p != null && ("near_grocery" in p || "near_transit" in p)
      })
      if (anyScores) setHasScores(true)
    })()

    return () => {
      cancelled = true
    }
  }, [baseListings, customListing, savedKijijiImports, filters.walkMinutes])

  useEffect(() => {
    if (listings) onListingsChange?.(listings)
  }, [listings, onListingsChange])

  useEffect(() => {
    if (!focusListing || focusListingKey === 0) return
    const map = mapRef.current?.getMap()
    if (!map) return
    map.flyTo({
      center: [focusListing.lon, focusListing.lat],
      zoom: 15,
      duration: 1200,
    })
    setPopupInfo({
      longitude: focusListing.lon,
      latitude: focusListing.lat,
      properties: focusListing.properties,
      layerId: "listings-symbol",
    })
  }, [focusListing, focusListingKey])

  useEffect(() => {
    if (!customListing || flyToCustomKey === 0) return
    const coords = customListing.geometry?.coordinates
    if (!coords || coords.length < 2) return
    const map = mapRef.current?.getMap()
    if (!map) return
    map.flyTo({
      center: [coords[0], coords[1]],
      zoom: 15,
      duration: 1200,
    })
    const p = customListing.properties ?? {}
    setPopupInfo({
      longitude: coords[0],
      latitude: coords[1],
      properties: p,
      layerId: "listings-symbol",
    })
  }, [customListing, flyToCustomKey])

  const listingFilterExpr = useMemo(
    () =>
      buildListingMapFilter(filters, {
        staticListings: layers.staticListings,
        kijijiListings: layers.kijijiListings,
      }) as mapboxgl.FilterSpecification,
    [filters, layers.staticListings, layers.kijijiListings],
  )

  const listingIconExpr = useMemo((): mapboxgl.DataDrivenPropertyValueSpecification<string> => {
    if (!hasScores) return "house-default"
    return [
      "case",
      ["==", ["get", "eligible"], true], "house-walkable",
      ["==", ["get", "near_grocery"], true], "house-grocery",
      ["==", ["get", "near_transit"], true], "house-transit",
      "house-neither",
    ]
  }, [hasScores])

  const handleMoveStart = useCallback(() => {
    mapInteractingRef.current = true
    setPopupInfo(null)
    setCursor("auto")
  }, [])

  const handleMoveEnd = useCallback(() => {
    mapInteractingRef.current = false
  }, [])

  // Recompute stats from raw data (not rendered features) so they're always accurate
  useEffect(() => {
    if (!listings) return
    const layerState = {
      staticListings: layers.staticListings,
      kijijiListings: layers.kijijiListings,
    }
    const features = listings.features.filter((f) => {
      const p = f.properties ?? {}
      if (isCustomListing(p.source)) return false
      return passesListingFilters(p, filters, layerState)
    })
    const total = features.length
    const walkable = features.filter(f => f.properties?.eligible).length
    onStatsUpdate(total, walkable)
  }, [filters, listings, layers.staticListings, layers.kijijiListings, onStatsUpdate])

  const isListingPopup = useCallback((info: PopupInfo | null) => {
    if (!info) return false
    return isListingFeature(info.properties)
  }, [])

  const tryDismissPopup = useCallback(() => {
    if (popupHoverRef.current) return
    setPopupInfo(null)
    setCursor("auto")
  }, [])

  const handleListingPopupMouseEnter = useCallback(() => {
    popupHoverRef.current = true
  }, [])

  const handleListingPopupMouseLeave = useCallback(() => {
    popupHoverRef.current = false
    setPopupInfo(null)
    setCursor("auto")
  }, [])

  const handleMouseMove = useCallback((event: MapLayerMouseEvent) => {
    if (mapInteractingRef.current) return

    const feature =
      event.features?.find((f) => f.layer?.id === "listings-symbol") ??
      event.features?.find((f) => f.layer?.id === "groceries-symbol") ??
      event.features?.find((f) =>
        f.layer?.id === "listings-symbol" ||
        isListingFeature(f.properties ?? {}),
      ) ??
      event.features?.[0]
    if (!feature) {
      setCursor("auto")
      tryDismissPopup()
      return
    }

    popupHoverRef.current = false

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
  }, [tryDismissPopup])

  const handleMouseLeave = useCallback(() => {
    // Next tick so pointer can enter the popup DOM without closing first
    setTimeout(() => tryDismissPopup(), 0)
  }, [tryDismissPopup])

  const formatPopup = (info: PopupInfo) => {
    const p = info.properties

    if (isListingFeature(p)) {
      return (
        <ListingPopupCard properties={p} showBadge={hasScores || isCustomListing(p.source)} />
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
      return <GroceryPopupCard properties={p} />
    }

    return <p className="text-foreground text-sm">No details</p>
  }

  return (
    <Map
      ref={mapRef}
      mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
      initialViewState={{ ...CENTER, zoom: ZOOM }}
      style={{ width: "100%", height: "100%" }}
      mapStyle={MAP_STYLE[theme]}
      styleDiffing={false}
      interactiveLayerIds={[
        "listings-symbol",
        "groceries-symbol",
        "stops-circle",
        "smoke-centers",
        "smoke-zones-fill",
      ]}
      cursor={cursor}
      onLoad={loadMapIcons}
      onMoveStart={handleMoveStart}
      onMoveEnd={handleMoveEnd}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
    >
      <NavigationControl position="bottom-right" />
      {onLocateMe && (
        <GeolocateControl
          position="bottom-right"
          trackUserLocation={false}
          showAccuracyCircle={false}
          onGeolocate={(e) => onLocateMe(e.coords.longitude, e.coords.latitude)}
        />
      )}

      {/* ── Listings (pre-colored house icons, same pattern as groceries) ── */}
      {listings && houseIconReady && (
        <Source key={`listings-${theme}`} id="listings" type="geojson" data={listings}>
          <Layer
            id="listings-symbol"
            type="symbol"
            filter={listingFilterExpr}
            layout={{
              "icon-image": listingIconExpr,
              "icon-anchor": "bottom",
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
        <Source key={`groceries-${theme}`} id="groceries" type="geojson" data={groceries}>
          <Layer
            id="groceries-symbol"
            type="symbol"
            layout={{
              "icon-image": "grocery-icon",
              "icon-anchor": "bottom",
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
        <Source key={`stops-${theme}`} id="stops" type="geojson" data={stops}>
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
        <Source key={`smoke-${filters.walkMinutes}-${theme}`} id="smoke" type="geojson" data={smokeData}>
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
          offset={POI_POPUP_OFFSET}
          className={
            isListingFeature(popupInfo.properties)
              ? "padestrian-listing-popup"
              : popupInfo.properties.name != null
                ? "padestrian-grocery-popup"
                : "padestrian-map-popup"
          }
        >
          {isListingPopup(popupInfo) ? (
            <div
              onMouseEnter={handleListingPopupMouseEnter}
              onMouseLeave={handleListingPopupMouseLeave}
            >
              {formatPopup(popupInfo)}
            </div>
          ) : (
            formatPopup(popupInfo)
          )}
        </Popup>
      )}
    </Map>
  )
}
