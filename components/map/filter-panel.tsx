"use client"

import { useMemo, useState } from "react"
import { ChevronDown, ChevronLeft, ChevronRight, Moon, Sun } from "lucide-react"
import type { FeatureCollection } from "geojson"
import { Slider } from "@/components/ui/slider"
import { PedestrianToggle } from "@/components/ui/pedestrian-toggle"
import { AddressSearch } from "@/components/map/address-search"
import { KijijiListPanel } from "@/components/map/kijiji-list-panel"
import type { GeocodeResult } from "@/lib/geocode"
import { buildKijijiListItems, type KijijiListItem } from "@/lib/kijiji-listings"
import { cn } from "@/lib/utils"

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

interface FilterPanelProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  layers: LayerVisibility
  onLayersChange: (layers: LayerVisibility) => void
  stats: { total: number; walkable: number }
  theme: "light" | "dark"
  onThemeToggle: () => void
  hasCustomListing: boolean
  isCheckingAddress: boolean
  addressError: string | null
  onCheckAddressQuery: (query: string) => void
  onSelectAddress: (result: GeocodeResult) => void
  onClearCustomAddress: () => void
  listingsData: FeatureCollection | null
  onFocusKijijiListing: (item: KijijiListItem) => void
  selectedKijijiId: string | null
}

const bedOptions = [
  { value: "any", label: "Any" },
  { value: "0", label: "Studio" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3+" },
]

export function FilterPanel({
  filters,
  onFiltersChange,
  layers,
  onLayersChange,
  stats,
  theme,
  onThemeToggle,
  hasCustomListing,
  isCheckingAddress,
  addressError,
  onCheckAddressQuery,
  onSelectAddress,
  onClearCustomAddress,
  listingsData,
  onFocusKijijiListing,
  selectedKijijiId,
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [pressed, setPressed] = useState(false)
  const [kijijiListOpen, setKijijiListOpen] = useState(false)
  const [isEditingMaxRent, setIsEditingMaxRent] = useState(false)
  const [maxRentInput, setMaxRentInput] = useState("")

  // Staggered entry style for each content section
  const section = (delay: number): React.CSSProperties => ({
    opacity: isOpen ? 1 : 0,
    transform: isOpen ? 'translateY(0)' : 'translateY(12px)',
    transition: isOpen
      ? `opacity 200ms ease ${delay}ms, transform 260ms cubic-bezier(0.25, 1, 0.5, 1) ${delay}ms`
      : 'opacity 80ms ease, transform 80ms ease',
  })

  const kijijiListItems = useMemo(
    () =>
      buildKijijiListItems(listingsData, filters, {
        staticListings: layers.staticListings,
        kijijiListings: layers.kijijiListings,
      }),
    [listingsData, filters, layers.staticListings, layers.kijijiListings],
  )

  const MIN_RENT = 1000
  const MAX_RENT = 3500
  const RENT_STEP = 50

  const clampRent = (value: number) =>
    Math.min(MAX_RENT, Math.max(MIN_RENT, value))

  const snapRent = (value: number) =>
    Math.round(value / RENT_STEP) * RENT_STEP

  const applyMaxRentInput = () => {
    const digitsOnly = maxRentInput.replace(/[^\d]/g, "")
    if (!digitsOnly) {
      setIsEditingMaxRent(false)
      setMaxRentInput("")
      return
    }
    const parsed = Number.parseInt(digitsOnly, 10)
    const next = clampRent(snapRent(parsed))
    onFiltersChange({ ...filters, maxRent: next })
    setIsEditingMaxRent(false)
    setMaxRentInput("")
  }

  const toggleBedOption = (value: string) => {
    if (value === "any") {
      onFiltersChange({ ...filters, beds: ["any"] })
      return
    }

    const current = new Set(filters.beds)
    current.delete("any")

    if (current.has(value)) {
      current.delete(value)
    } else {
      current.add(value)
    }

    const ordered = bedOptions
      .map((opt) => opt.value)
      .filter((opt) => opt !== "any" && current.has(opt))

    const allSpecificSelected = ordered.length === bedOptions.length - 1

    onFiltersChange({
      ...filters,
      beds: allSpecificSelected || ordered.length === 0 ? ["any"] : ordered,
    })
  }

  return (
    <>
      {/* Collapsed state - floating logo button */}
      <button
        onClick={() => setIsOpen(true)}
        onMouseDown={() => setPressed(true)}
        onMouseUp={() => setPressed(false)}
        onMouseLeave={() => setPressed(false)}
        onTouchStart={() => setPressed(true)}
        onTouchEnd={() => setPressed(false)}
        style={{
          transform: pressed ? 'scale(0.97)' : 'scale(1)',
          opacity: isOpen ? 0 : 1,
          pointerEvents: isOpen ? 'none' : undefined,
          transition: 'transform 60ms ease, opacity 180ms ease',
        }}
        className="absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2.5 rounded-xl border shadow-lg bg-card/95 backdrop-blur-xl border-border hover:bg-card"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/logo.png"
          alt="Padestrian"
          width={28}
          style={{ height: "auto" }}
        />
        <span className="font-semibold text-foreground tracking-tight">Padestrian</span>
        <div className="ml-2 px-2 py-0.5 rounded-full bg-[#6BBF91]/20 text-[#6BBF91] text-xs font-medium">
          {stats.walkable}
        </div>
      </button>

      {/* Theme toggle - always visible top right */}
      <button
        onClick={onThemeToggle}
        className="absolute top-4 right-4 z-20 flex size-10 shrink-0 items-center justify-center rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-lg hover:bg-card transition-colors"
        aria-label="Toggle theme"
      >
        {theme === "dark" ? (
          <Sun className="w-5 h-5 text-foreground" />
        ) : (
          <Moon className="w-5 h-5 text-foreground" />
        )}
      </button>

      {/* Expanded sidebar */}
      <aside
        className="absolute top-0 left-0 z-30 flex h-full w-80 flex-col bg-card/95 backdrop-blur-xl border-r border-border shadow-2xl overflow-hidden"
        style={{
          transform: isOpen ? 'translateX(0)' : 'translateX(-100%)',
          transition: isOpen
            ? 'transform 320ms cubic-bezier(0.25, 1, 0.5, 1)'
            : 'transform 240ms cubic-bezier(0.4, 0, 0.6, 1)',
        }}
      >
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-4 border-b border-border"
          style={section(40)}
        >
          <div className="flex items-center gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/images/logo.png"
              alt="Padestrian"
              width={32}
              style={{ height: "auto" }}
            />
            <div>
              <h1 className="font-semibold text-foreground tracking-tight">Padestrian</h1>
              <p className="text-xs text-muted-foreground">Ottawa walkable rentals</p>
            </div>
          </div>
          <div className="w-8" aria-hidden />
        </div>

        {/* Stats banner */}
        <div
          className="px-5 py-3 bg-secondary/50 border-b border-border"
          style={section(80)}
        >
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground dark:text-zinc-300">Showing</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{stats.total} listings</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-[#6BBF91] font-medium">{stats.walkable} walkable</span>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="p-5 space-y-5 pb-4">
            <div style={section(120)}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-zinc-300 mb-3">
                Check an address
              </div>
              <AddressSearch
                hasCustomListing={hasCustomListing}
                isChecking={isCheckingAddress}
                error={addressError}
                onCheckQuery={onCheckAddressQuery}
                onSelectAddress={onSelectAddress}
                onClear={onClearCustomAddress}
              />
            </div>

            {/* Filters section */}
            <div style={section(165)}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-zinc-300 mb-4">
                Filters
              </div>

              {/* Walkable toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-[#6BBF91]" />
                  <span className="text-sm font-medium text-foreground">Walkable only</span>
                </div>
                <PedestrianToggle
                  checked={filters.walkableOnly}
                  onCheckedChange={(checked) =>
                    onFiltersChange({ ...filters, walkableOnly: checked })
                  }
                  ariaLabel="Toggle walkable only"
                />
              </div>

              {/* Max rent slider */}
              <div className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground dark:text-zinc-300">Max rent</span>
                  {isEditingMaxRent ? (
                    <input
                      type="text"
                      inputMode="numeric"
                      value={maxRentInput}
                      onChange={(e) => setMaxRentInput(e.target.value)}
                      onBlur={applyMaxRentInput}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") applyMaxRentInput()
                        if (e.key === "Escape") {
                          setIsEditingMaxRent(false)
                          setMaxRentInput("")
                        }
                      }}
                      autoFocus
                      className="h-7 w-24 rounded-md border border-border bg-background px-2 text-right text-sm font-medium text-foreground tabular-nums outline-none ring-offset-background focus-visible:ring-2 focus-visible:ring-ring"
                      aria-label="Max rent"
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditingMaxRent(true)
                        setMaxRentInput(String(filters.maxRent))
                      }}
                      className="rounded px-1 py-0.5 text-sm font-medium text-foreground tabular-nums hover:bg-secondary"
                      aria-label="Edit max rent"
                    >
                      {filters.maxRent >= MAX_RENT ? "Any" : `$${filters.maxRent.toLocaleString()}`}
                    </button>
                  )}
                </div>
                <Slider
                  value={[filters.maxRent]}
                  min={MIN_RENT}
                  max={MAX_RENT}
                  step={RENT_STEP}
                  onValueChange={([value]) =>
                    onFiltersChange({ ...filters, maxRent: clampRent(value) })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>$1,000</span>
                  <span>$3,500+</span>
                </div>
              </div>

              {/* Bedrooms */}
              <div className="py-2 space-y-3">
                <span className="text-sm text-muted-foreground dark:text-zinc-300">Bedrooms</span>
                <div className="flex gap-1.5">
                  {bedOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => toggleBedOption(opt.value)}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                        filters.beds.includes(opt.value)
                          ? "bg-foreground text-background"
                          : "bg-secondary text-muted-foreground hover:bg-secondary/80 hover:text-foreground"
                      )}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* Legend */}
            <div className="pt-4 border-t border-border" style={section(215)}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-zinc-300 mb-3">
                Legend
              </div>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { color: "bg-[#6BBF91]", label: "Walkable" },
                  { color: "bg-lime-500", label: "Grocery only" },
                  { color: "bg-violet-500", label: "Transit only" },
                  { color: "bg-slate-500", label: "Neither" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 min-w-0 rounded-md bg-secondary/40 px-2 py-1.5">
                    <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", item.color)} />
                    <span className="text-xs text-muted-foreground dark:text-zinc-300 truncate">{item.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2 rounded-md bg-secondary/30 px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-[#6BBF91]/15 shrink-0">
                    <img
                      src="/images/house-walkable.png"
                      alt=""
                      width={12}
                      height={12}
                      className="block h-3 w-3 object-contain"
                    />
                  </span>
                  <span className="text-xs leading-none text-muted-foreground dark:text-zinc-300">
                    Rental listings (colored by walkability)
                  </span>
                </div>
              </div>
            </div>

            {/* Layers section */}
            <div className="mt-2 pt-3 border-t border-border" style={section(260)}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-zinc-300 mb-3">
                Layers
              </div>
              <div className="space-y-0.5">
                <label className="flex items-center justify-between py-1.5 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <img src="/images/grocery-icon.png" alt="" width={18} height={18} className="shrink-0" />
                    <span className="text-sm text-muted-foreground dark:text-zinc-300 group-hover:text-foreground transition-colors">Grocery stores</span>
                  </div>
                  <PedestrianToggle
                    checked={layers.groceries}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, groceries: checked })
                    }
                    ariaLabel="Toggle grocery stores layer"
                  />
                </label>
                <label className="flex items-center justify-between py-1.5 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#0ea5e9" }} />
                    <span className="text-sm text-muted-foreground dark:text-zinc-300 group-hover:text-foreground transition-colors">Transit stops</span>
                  </div>
                  <PedestrianToggle
                    checked={layers.transit}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, transit: checked })
                    }
                    ariaLabel="Toggle transit stops layer"
                  />
                </label>
                <label className="flex items-center justify-between py-1.5 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground dark:text-zinc-300 group-hover:text-foreground transition-colors">Walk zones</span>
                  </div>
                  <PedestrianToggle
                    checked={layers.smoke}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, smoke: checked })
                    }
                    ariaLabel="Toggle walk zones layer"
                  />
                </label>
                <div className="pt-2 mt-1 border-t border-border/70">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground dark:text-zinc-400 mb-1.5">
                    Listing sources
                  </div>
                </div>
                <label className="flex items-center justify-between py-1.5 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground dark:text-zinc-300 group-hover:text-foreground transition-colors">Static listings</span>
                  </div>
                  <PedestrianToggle
                    checked={layers.staticListings}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, staticListings: checked })
                    }
                    ariaLabel="Toggle static listings source"
                  />
                </label>
                <div>
                  <label className="flex items-center justify-between py-1.5 cursor-pointer group">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="text-sm text-muted-foreground dark:text-zinc-300 group-hover:text-foreground transition-colors">
                        Kijiji/live listings
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()
                          setKijijiListOpen((open) => !open)
                        }}
                        className={cn(
                          "flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors",
                          "hover:bg-secondary hover:text-foreground",
                          kijijiListOpen && "text-foreground",
                        )}
                        aria-expanded={kijijiListOpen}
                        aria-label={
                          kijijiListOpen ? "Collapse Kijiji list" : "Expand Kijiji list"
                        }
                      >
                        {kijijiListOpen ? (
                          <ChevronDown className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                        )}
                      </button>
                    </div>
                    <PedestrianToggle
                      checked={layers.kijijiListings}
                      onCheckedChange={(checked) =>
                        onLayersChange({ ...layers, kijijiListings: checked })
                      }
                      ariaLabel="Toggle Kijiji listings source"
                    />
                  </label>
                  {kijijiListOpen ? (
                    <div className="ml-7">
                      <KijijiListPanel
                        items={kijijiListItems}
                        selectedId={selectedKijijiId}
                        onSelect={onFocusKijijiListing}
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-border bg-secondary/30 px-5 py-3" style={section(300)}>
          <p className="text-center text-xs text-muted-foreground dark:text-zinc-400">
            Find your car-free apartment
          </p>
        </div>
      </aside>

      {/* Backdrop overlay when open */}
      {isOpen && (
        <div
          className="absolute inset-0 z-20 bg-black/20 backdrop-blur-sm md:hidden"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Collapse button when expanded - visible on larger screens */}
      <button
        onClick={() => setIsOpen(false)}
        className={cn(
          "absolute top-1/2 -translate-y-1/2 z-30 p-1.5 rounded-r-lg bg-card border border-l-0 border-border shadow-lg transition-all duration-300 hidden md:flex",
          isOpen ? "left-80" : "left-0 opacity-0 pointer-events-none"
        )}
        aria-label="Collapse panel"
      >
        <ChevronLeft className="w-4 h-4 text-muted-foreground" />
      </button>
    </>
  )
}
