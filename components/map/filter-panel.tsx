"use client"

import { useState } from "react"
import { ChevronLeft, Moon, Sun } from "lucide-react"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

interface Filters {
  walkableOnly: boolean
  maxRent: number
  beds: string
}

interface LayerVisibility {
  groceries: boolean
  transit: boolean
  smoke: boolean
}

interface FilterPanelProps {
  filters: Filters
  onFiltersChange: (filters: Filters) => void
  layers: LayerVisibility
  onLayersChange: (layers: LayerVisibility) => void
  stats: { total: number; walkable: number }
  theme: "light" | "dark"
  onThemeToggle: () => void
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
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <>
      {/* Collapsed state - floating logo button */}
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "absolute top-4 left-4 z-20 flex items-center gap-2 px-3 py-2.5 rounded-xl border shadow-lg transition-all duration-300",
          "bg-card/95 backdrop-blur-xl border-border hover:bg-card",
          isOpen && "opacity-0 pointer-events-none"
        )}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/images/logo.png"
          alt="Padestrian"
          width={28}
          style={{ height: "auto" }}
        />
        <span className="font-semibold text-foreground tracking-tight">Padestrian</span>
        <div className="ml-2 px-2 py-0.5 rounded-full bg-orange-500/20 text-orange-500 text-xs font-medium">
          {stats.walkable}
        </div>
      </button>

      {/* Theme toggle - always visible top right */}
      <button
        onClick={onThemeToggle}
        className="absolute top-4 right-4 z-20 p-2.5 rounded-xl bg-card/95 backdrop-blur-xl border border-border shadow-lg hover:bg-card transition-colors"
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
        className={cn(
          "absolute top-0 left-0 z-30 h-full w-80 bg-card/95 backdrop-blur-xl border-r border-border shadow-2xl transition-transform duration-300 ease-out",
          isOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
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
        <div className="px-5 py-3 bg-secondary/50 border-b border-border">
          <div className="flex items-center justify-between">
            <span className="text-sm text-muted-foreground">Showing</span>
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-foreground">{stats.total} listings</span>
              <span className="text-muted-foreground">·</span>
              <span className="text-sm text-orange-500 font-medium">{stats.walkable} walkable</span>
            </div>
          </div>
        </div>

        {/* Scrollable content */}
        <div className="overflow-y-auto h-[calc(100%-180px)] pb-4">
          <div className="p-5 space-y-6">
            {/* Filters section */}
            <div>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-4">
                Filters
              </div>

              {/* Walkable toggle */}
              <div className="flex items-center justify-between py-2">
                <div className="flex items-center gap-2">
                  <div className="w-2.5 h-2.5 rounded-full bg-orange-500" />
                  <span className="text-sm font-medium text-foreground">Walkable only</span>
                </div>
                <Switch
                  checked={filters.walkableOnly}
                  onCheckedChange={(checked) =>
                    onFiltersChange({ ...filters, walkableOnly: checked })
                  }
                />
              </div>

              {/* Max rent slider */}
              <div className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Max rent</span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {filters.maxRent >= 3500 ? "Any" : `$${filters.maxRent.toLocaleString()}`}
                  </span>
                </div>
                <Slider
                  value={[filters.maxRent]}
                  min={1000}
                  max={3500}
                  step={50}
                  onValueChange={([value]) =>
                    onFiltersChange({ ...filters, maxRent: value })
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
                <span className="text-sm text-muted-foreground">Bedrooms</span>
                <div className="flex gap-1.5">
                  {bedOptions.map((opt) => (
                    <button
                      key={opt.value}
                      onClick={() => onFiltersChange({ ...filters, beds: opt.value })}
                      className={cn(
                        "flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-all duration-150",
                        filters.beds === opt.value
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
            <div className="pt-4 border-t border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Legend
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-2">
                {[
                  { color: "bg-orange-500", label: "Walkable" },
                  { color: "bg-lime-500", label: "Grocery only" },
                  { color: "bg-violet-500", label: "Transit only" },
                  { color: "bg-slate-500", label: "Neither" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 min-w-0">
                    <div className={cn("w-2.5 h-2.5 rounded-full shrink-0", item.color)} />
                    <span className="text-xs text-muted-foreground truncate">{item.label}</span>
                  </div>
                ))}
              </div>
              <div className="mt-2">
                <div className="flex items-center gap-2 py-1.5">
                  <span className="inline-flex h-4 w-4 items-center justify-center rounded-sm bg-orange-500/15 shrink-0">
                    <img
                      src="/images/house-walkable.png"
                      alt=""
                      width={12}
                      height={12}
                      className="block h-3 w-3 object-contain"
                    />
                  </span>
                  <span className="text-xs leading-none text-muted-foreground">
                    Rental listings (colored by walkability)
                  </span>
                </div>
              </div>
            </div>

            {/* Layers section */}
            <div className="mt-2 pt-3 border-t border-border">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-3">
                Layers
              </div>
              <div className="space-y-1">
                <label className="flex items-center justify-between py-2 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <img src="/images/grocery-icon.png" alt="" width={18} height={18} className="shrink-0" />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Grocery stores</span>
                  </div>
                  <Switch
                    checked={layers.groceries}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, groceries: checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between py-2 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full" style={{ background: "#0ea5e9" }} />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Transit stops</span>
                  </div>
                  <Switch
                    checked={layers.transit}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, transit: checked })
                    }
                  />
                </label>
                <label className="flex items-center justify-between py-2 cursor-pointer group">
                  <div className="flex items-center gap-2">
                    <div className="w-2.5 h-2.5 rounded-full bg-slate-500" />
                    <span className="text-sm text-muted-foreground group-hover:text-foreground transition-colors">Walk zones</span>
                  </div>
                  <Switch
                    checked={layers.smoke}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, smoke: checked })
                    }
                  />
                </label>
              </div>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="absolute bottom-0 left-0 right-0 px-5 py-3 bg-secondary/30 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">
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
