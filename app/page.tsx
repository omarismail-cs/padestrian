"use client"

import { useState, useCallback, useEffect } from "react"
import dynamic from "next/dynamic"
import { FilterPanel } from "@/components/map/filter-panel"

// Dynamically import MapView to avoid SSR issues with Mapbox
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
  }
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

  // Apply theme class to html element
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

  return (
    <main className="relative w-full h-screen overflow-hidden bg-background">
      <MapView
        filters={filters}
        layers={layers}
        onStatsUpdate={handleStatsUpdate}
        theme={theme}
      />
      <FilterPanel
        filters={filters}
        onFiltersChange={setFilters}
        layers={layers}
        onLayersChange={setLayers}
        stats={stats}
        theme={theme}
        onThemeToggle={handleThemeToggle}
      />
    </main>
  )
}
