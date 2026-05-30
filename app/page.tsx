"use client"

import { useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import type { Feature, FeatureCollection, Point } from "geojson"
import { FilterPanel } from "@/components/map/filter-panel"
import type { MapFocusListing } from "@/components/map/map-view"
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode"
import {
  buildCustomListingFeature,
  clearCustomAddressStorage,
  loadCustomAddressFromStorage,
  saveCustomAddressToStorage,
} from "@/lib/custom-listing"
import type { KijijiListItem } from "@/lib/kijiji-listings"
import { scorePoint, ScoringDataError } from "@/lib/score-point"

const MapView = dynamic(
  () => import("@/components/map/map-view").then((mod) => mod.MapView),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-full flex items-center justify-center bg-background">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
          <span className="text-sm text-muted-foreground">Loading map...</span>
        </div>
      </div>
    ),
  },
)

export default function Page() {
  const [theme, setTheme] = useState<"light" | "dark">("dark")
  const [filters, setFilters] = useState({
    walkableOnly: false,
    maxRent: 3500,
    beds: ["any"],
  })

  const [layers, setLayers] = useState({
    groceries: true,
    transit: false,
    smoke: false,
    staticListings: true,
    kijijiListings: true,
  })

  const [stats, setStats] = useState({
    total: 0,
    walkable: 0,
  })

  const [listingsData, setListingsData] = useState<FeatureCollection | null>(null)
  const [customListing, setCustomListing] = useState<Feature<Point> | null>(null)
  const [isCheckingAddress, setIsCheckingAddress] = useState(false)
  const [addressError, setAddressError] = useState<string | null>(null)
  const [flyToCustomKey, setFlyToCustomKey] = useState(0)
  const [focusListing, setFocusListing] = useState<MapFocusListing | null>(null)
  const [focusListingKey, setFocusListingKey] = useState(0)
  const [selectedKijijiId, setSelectedKijijiId] = useState<string | null>(null)

  useEffect(() => {
    const stored = loadCustomAddressFromStorage()
    if (stored) setCustomListing(stored)
  }, [])

  useEffect(() => {
    if (theme === "dark") {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }, [theme])

  const handleThemeToggle = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"))
  }, [])

  const handleStatsUpdate = useCallback((total: number, walkable: number) => {
    setStats({ total, walkable })
  }, [])

  const handleListingsChange = useCallback((fc: FeatureCollection) => {
    setListingsData(fc)
  }, [])

  const applyGeocodedAddress = useCallback(async (geocoded: GeocodeResult) => {
    setIsCheckingAddress(true)
    setAddressError(null)
    try {
      const score = await scorePoint(geocoded.lon, geocoded.lat)
      const feature = buildCustomListingFeature(geocoded, score)
      setCustomListing(feature)
      saveCustomAddressToStorage(feature)
      setFlyToCustomKey((k) => k + 1)
    } catch (err) {
      if (err instanceof ScoringDataError) {
        setAddressError(err.message)
      } else if (err instanceof Error && err.message.includes("Mapbox")) {
        setAddressError(err.message)
      } else {
        setAddressError("Could not check that address. Try again.")
      }
    } finally {
      setIsCheckingAddress(false)
    }
  }, [])

  const handleCheckAddressQuery = useCallback(
    async (query: string) => {
      const geocoded = await geocodeAddress(query)
      if (!geocoded) {
        setAddressError("Address not found in Ottawa. Try a full street address.")
        return
      }
      await applyGeocodedAddress(geocoded)
    },
    [applyGeocodedAddress],
  )

  const handleSelectAddress = useCallback(
    (geocoded: GeocodeResult) => {
      void applyGeocodedAddress(geocoded)
    },
    [applyGeocodedAddress],
  )

  const handleClearCustomAddress = useCallback(() => {
    setCustomListing(null)
    clearCustomAddressStorage()
    setAddressError(null)
  }, [])

  const handleFocusKijijiListing = useCallback(
    (item: KijijiListItem) => {
      if (!layers.kijijiListings) {
        setLayers((prev) => ({ ...prev, kijijiListings: true }))
      }
      setSelectedKijijiId(item.id)
      setFocusListing({
        lon: item.lon,
        lat: item.lat,
        properties: item.properties,
      })
      setFocusListingKey((k) => k + 1)
    },
    [layers.kijijiListings],
  )

  return (
    <main className="relative w-full h-screen overflow-hidden bg-background">
      <MapView
        filters={filters}
        layers={layers}
        onStatsUpdate={handleStatsUpdate}
        theme={theme}
        customListing={customListing}
        flyToCustomKey={flyToCustomKey}
        onListingsChange={handleListingsChange}
        focusListing={focusListing}
        focusListingKey={focusListingKey}
      />
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        layers={layers}
        onLayersChange={setLayers}
        stats={stats}
        theme={theme}
        onThemeToggle={handleThemeToggle}
        hasCustomListing={customListing != null}
        isCheckingAddress={isCheckingAddress}
        addressError={addressError}
        onCheckAddressQuery={handleCheckAddressQuery}
        onSelectAddress={handleSelectAddress}
        onClearCustomAddress={handleClearCustomAddress}
        listingsData={listingsData}
        onFocusKijijiListing={handleFocusKijijiListing}
        selectedKijijiId={selectedKijijiId}
      />
    </main>
  )
}
