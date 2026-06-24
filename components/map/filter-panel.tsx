"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, ChevronLeft, ChevronRight, Github, Moon, RefreshCw, Sun, X } from "lucide-react"
import type { FeatureCollection, Feature, Point } from "geojson"
import { Slider } from "@/components/ui/slider"
import { PedestrianToggle } from "@/components/ui/pedestrian-toggle"
import { AddressSearch } from "@/components/map/address-search"
import { KijijiListPanel } from "@/components/map/kijiji-list-panel"
import type { GeocodeResult } from "@/lib/geocode"
import { buildKijijiListItems, type KijijiListItem } from "@/lib/kijiji-listings"
import type { WalkMinutes } from "@/lib/score-point"
import { cn } from "@/lib/utils"

function formatLastUpdated(iso: string): string {
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000)
  if (diff < 60) return "just now"
  const mins = Math.floor(diff / 60)
  if (mins < 60) return `${mins} minute${mins === 1 ? "" : "s"} ago`
  const hours = Math.floor(diff / 3600)
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`
  const days = Math.floor(diff / 86400)
  return `${days} day${days === 1 ? "" : "s"} ago`
}

const LAYER_ICON_SLOT = "flex w-6 shrink-0 items-center justify-center"

function WalkZonesIcon() {
  return (
    <svg viewBox="0 0 20 20" className="h-4 w-4" aria-hidden>
      <path
        d="M10 2.5 16.5 7.25 14 16.5 6 16.5 3.5 7.25Z"
        fill="none"
        stroke="#84cc16"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path
        d="M10 6 13.5 9 12 14 8 14 6.5 9Z"
        fill="none"
        stroke="#8b5cf6"
        strokeWidth="1.25"
        strokeLinejoin="round"
        opacity="0.9"
      />
    </svg>
  )
}

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
  listingsUpdatedAt?: string
  onFocusKijijiListing: (item: KijijiListItem) => void
  selectedKijijiId: string | null
  savedKijijiImports: Feature<Point>[]
  onImportedKijiji: (features: Feature<Point>[]) => void
  onRemoveSavedKijiji: (id: string) => void
}

const bedOptions = [
  { value: "any", label: "Any" },
  { value: "0", label: "Studio" },
  { value: "1", label: "1" },
  { value: "2", label: "2" },
  { value: "3", label: "3+" },
]

const MIN_RENT = 1000
const MAX_RENT = 3500
const RENT_STEP = 50
const RENT_HISTOGRAM_BINS = 25
const MIN_WALK_MINUTES = 10
const MAX_WALK_MINUTES = 20
const WALK_MINUTES_STEP = 5

function clampWalkMinutes(value: number): WalkMinutes {
  if (value <= 10) return 10
  if (value <= 15) return 15
  return 20
}

function buildRentHistogram(
  fc: FeatureCollection | null,
  layers: { staticListings: boolean; kijijiListings: boolean },
): number[] {
  const bins = Array(RENT_HISTOGRAM_BINS).fill(0)
  if (!fc?.features?.length) return bins

  const binWidth = (MAX_RENT - MIN_RENT) / RENT_HISTOGRAM_BINS

  for (const feature of fc.features) {
    const p = feature.properties ?? {}
    if (String(p.source ?? "").toLowerCase() === "custom") continue
    if (p.rent_cad == null) continue

    const isKijiji =
      String(p.source ?? "").toLowerCase() === "kijiji" ||
      String(p.source ?? "").toLowerCase() === "kijiji-saved"
    if (isKijiji && !layers.kijijiListings) continue
    if (!isKijiji && !layers.staticListings) continue

    const rent = Number(p.rent_cad)
    if (!Number.isFinite(rent) || rent < MIN_RENT) continue

    const clamped = Math.min(rent, MAX_RENT)
    let idx = Math.floor((clamped - MIN_RENT) / binWidth)
    if (idx >= RENT_HISTOGRAM_BINS) idx = RENT_HISTOGRAM_BINS - 1
    bins[idx]++
  }

  return bins
}

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
  listingsUpdatedAt,
  onFocusKijijiListing,
  selectedKijijiId,
  savedKijijiImports,
  onImportedKijiji,
  onRemoveSavedKijiji,
}: FilterPanelProps) {
  const [isOpen, setIsOpen] = useState(true)
  const [pressed, setPressed] = useState(false)
  const [kijijiListOpen, setKijijiListOpen] = useState(false)
  const logoIcon =
    theme === "dark" ? "/images/logo-icon-light.png" : "/images/logo-icon-dark.png"
  const logoLockup =
    theme === "dark" ? "/images/logo-lockup-light.png" : "/images/logo-lockup-dark.png"

  type RefreshMode = "prune" | "scrape"
  type RefreshState = "idle" | "loading" | "done" | "error"
  const [refreshState, setRefreshState] = useState<RefreshState>("idle")
  const [refreshMode, setRefreshMode] = useState<RefreshMode>("prune")
  const [refreshMessage, setRefreshMessage] = useState("")
  const [refreshStep, setRefreshStep] = useState("")
  const [refreshProgress, setRefreshProgress] = useState(0)
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const modeMenuRef = useRef<HTMLDivElement>(null)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (!modeMenuOpen) return
    const handler = (e: MouseEvent) => {
      if (modeMenuRef.current && !modeMenuRef.current.contains(e.target as Node)) {
        setModeMenuOpen(false)
      }
    }
    document.addEventListener("mousedown", handler)
    return () => document.removeEventListener("mousedown", handler)
  }, [modeMenuOpen])

  const triggerRefresh = async (mode: RefreshMode) => {
    if (refreshState === "loading") return
    setModeMenuOpen(false)
    setRefreshMode(mode)
    setRefreshState("loading")
    setRefreshProgress(0)
    setRefreshStep(mode === "scrape" ? "Scraping new listings…" : "Pruning dead listings…")
    setRefreshMessage("")
    if (resetTimer.current) clearTimeout(resetTimer.current)

    try {
      const res = await fetch("/api/refresh-kijiji", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode }),
      })

      if (!res.body) throw new Error("No response body")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split("\n")
        buffer = lines.pop() ?? ""
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.done) {
              if (!event.ok) {
                setRefreshState("error")
                setRefreshMessage(event.message ?? "Unknown error")
                resetTimer.current = setTimeout(() => setRefreshState("idle"), 5000)
              } else {
                setRefreshProgress(100)
                setRefreshState("done")
                setRefreshMessage(event.message ?? "Done")
                resetTimer.current = setTimeout(() => {
                  setRefreshState("idle")
                  window.location.reload()
                }, 6000)
              }
            } else {
              if (event.step) setRefreshStep(event.step)
              if (typeof event.progress === "number") setRefreshProgress(event.progress)
            }
          } catch {
            // skip malformed line
          }
        }
      }
    } catch (err) {
      setRefreshState("error")
      setRefreshMessage(err instanceof Error ? err.message : "Network error")
      resetTimer.current = setTimeout(() => setRefreshState("idle"), 5000)
    }
  }
  const [isEditingMaxRent, setIsEditingMaxRent] = useState(false)
  const [maxRentInput, setMaxRentInput] = useState("")
  const [, setRelativeTick] = useState(0)

  useEffect(() => {
    if (!listingsUpdatedAt) return
    const id = setInterval(() => setRelativeTick((t) => t + 1), 60_000)
    return () => clearInterval(id)
  }, [listingsUpdatedAt])

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

  const rentHistogram = useMemo(
    () =>
      buildRentHistogram(listingsData, {
        staticListings: layers.staticListings,
        kijijiListings: layers.kijijiListings,
      }),
    [listingsData, layers.staticListings, layers.kijijiListings],
  )

  const rentHistogramMax = useMemo(
    () => Math.max(...rentHistogram, 1),
    [rentHistogram],
  )

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
          src={logoIcon}
          alt="Padestrian"
          width={28}
          height={28}
          className="shrink-0"
        />
        <div className="ml-1 px-2 py-0.5 rounded-full bg-[#6BBF91]/20 text-[#6BBF91] text-xs font-medium">
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
          <div className="min-w-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={logoLockup}
              alt="Padestrian"
              height={28}
              className="h-7 w-auto max-w-[200px] object-contain object-left"
            />
            <p className="mt-1 text-xs text-muted-foreground">Ottawa walkable rentals</p>
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
          {listingsUpdatedAt && (
            <span className="mt-2 inline-flex items-center rounded-full border border-border/60 bg-background/60 px-2.5 py-0.5 text-[11px] text-muted-foreground dark:text-zinc-400">
              Last updated: {formatLastUpdated(listingsUpdatedAt)}
            </span>
          )}
        </div>

        {/* Scrollable content */}
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="p-5 space-y-5 pb-4">
            <div style={section(120)}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-zinc-300 mb-3">
                Check an address
              </div>
              <AddressSearch
                walkMinutes={filters.walkMinutes}
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

              {/* Walk time slider */}
              <div className="py-4 space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground dark:text-zinc-300">Walk time</span>
                  <span className="text-sm font-medium text-foreground tabular-nums">
                    {filters.walkMinutes} min
                  </span>
                </div>
                <Slider
                  value={[filters.walkMinutes]}
                  min={MIN_WALK_MINUTES}
                  max={MAX_WALK_MINUTES}
                  step={WALK_MINUTES_STEP}
                  onValueChange={([value]) =>
                    onFiltersChange({
                      ...filters,
                      walkMinutes: clampWalkMinutes(value),
                    })
                  }
                  className="w-full"
                />
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>10 min</span>
                  <span>15 min</span>
                  <span>20 min</span>
                </div>
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
                <div className="relative h-9 flex items-center">
                  <div
                    className="pointer-events-none absolute inset-x-0 flex h-7 items-end gap-px"
                    aria-hidden
                  >
                    {rentHistogram.map((count, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-t-[2px] bg-[#6BBF91]/25 dark:bg-[#6BBF91]/20"
                        style={{
                          height: `${(count / rentHistogramMax) * 100}%`,
                          minHeight: count > 0 ? 2 : 0,
                        }}
                      />
                    ))}
                  </div>
                  <Slider
                    value={[filters.maxRent]}
                    min={MIN_RENT}
                    max={MAX_RENT}
                    step={RENT_STEP}
                    onValueChange={([value]) =>
                      onFiltersChange({ ...filters, maxRent: clampRent(value) })
                    }
                    className="relative z-10 w-full"
                  />
                </div>
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
              <div className="grid grid-cols-2 gap-x-4 gap-y-2.5">
                {[
                  { src: "/images/house-walkable.png", label: "Walkable" },
                  { src: "/images/house-grocery.png", label: "Grocery only" },
                  { src: "/images/house-transit.png", label: "Transit only" },
                  { src: "/images/house-neither.png", label: "Neither" },
                ].map((item) => (
                  <div key={item.label} className="flex items-center gap-2 min-w-0">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={item.src}
                      alt=""
                      width={14}
                      height={14}
                      className="h-3.5 w-3.5 shrink-0 object-contain"
                    />
                    <span className="text-xs text-muted-foreground dark:text-zinc-300 truncate">
                      {item.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Layers section */}
            <div className="mt-2 pt-3 border-t border-border" style={section(260)}>
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground dark:text-zinc-300 mb-3">
                Layers
              </div>
              <div className="space-y-0.5">
                <label className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={LAYER_ICON_SLOT}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src="/images/grocery-icon.png"
                        alt=""
                        width={18}
                        height={18}
                        className="h-[18px] w-[18px] object-contain"
                      />
                    </div>
                    <span className="text-sm text-muted-foreground dark:text-zinc-300">Grocery stores</span>
                  </div>
                  <PedestrianToggle
                    checked={layers.groceries}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, groceries: checked })
                    }
                    ariaLabel="Toggle grocery stores layer"
                  />
                </label>
                <label className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={LAYER_ICON_SLOT}>
                      <div
                        className="h-2.5 w-2.5 rounded-full"
                        style={{ background: "#0ea5e9" }}
                      />
                    </div>
                    <span className="text-sm text-muted-foreground dark:text-zinc-300">Transit stops</span>
                  </div>
                  <PedestrianToggle
                    checked={layers.transit}
                    onCheckedChange={(checked) =>
                      onLayersChange({ ...layers, transit: checked })
                    }
                    ariaLabel="Toggle transit stops layer"
                  />
                </label>
                <label className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2 min-w-0">
                    <div className={LAYER_ICON_SLOT}>
                      <WalkZonesIcon />
                    </div>
                    <span className="text-sm text-muted-foreground dark:text-zinc-300">Walk zones</span>
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
                <label className="flex items-center justify-between py-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground dark:text-zinc-300">Static listings</span>
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
                  <label className="flex items-center justify-between py-1.5">
                    <div className="flex min-w-0 items-center gap-1">
                      <span className="text-sm text-muted-foreground dark:text-zinc-300">
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
                          "shrink-0 cursor-pointer text-muted-foreground transition-colors hover:text-foreground",
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

                      {/* Refresh button group */}
                      <div
                        className="relative flex items-center"
                        ref={modeMenuRef}
                      >
                        {/* Main refresh icon */}
                        <button
                          type="button"
                          title={
                            refreshState === "done"
                              ? refreshMessage
                              : refreshState === "error"
                              ? refreshMessage
                              : refreshState === "loading"
                              ? refreshStep
                              : refreshMode === "scrape"
                              ? "Prune + scrape new listings"
                              : "Prune dead listings"
                          }
                          disabled={refreshState === "loading"}
                          onClick={(e) => {
                            e.preventDefault()
                            e.stopPropagation()
                            triggerRefresh(refreshMode)
                          }}
                          className={cn(
                            "relative flex size-6 shrink-0 items-center justify-center rounded-md transition-colors disabled:pointer-events-none",
                            refreshState === "idle" && "text-muted-foreground hover:bg-secondary hover:text-foreground",
                            refreshState === "loading" && "text-[#6BBF91]",
                            refreshState === "done" && "text-[#6BBF91]",
                            refreshState === "error" && "text-red-500",
                          )}
                          aria-label="Refresh Kijiji listings"
                        >
                          {/* Progress ring */}
                          {refreshState === "loading" && (
                            <svg
                              className="absolute inset-0 w-full h-full -rotate-90"
                              viewBox="0 0 24 24"
                              fill="none"
                            >
                              <circle
                                cx="12" cy="12" r="10"
                                stroke="currentColor"
                                strokeOpacity="0.15"
                                strokeWidth="2"
                              />
                              <circle
                                cx="12" cy="12" r="10"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeDasharray="62.83"
                                strokeDashoffset="47"
                                className="animate-spin"
                                style={{ animationDuration: "1.4s" }}
                              />
                            </svg>
                          )}
                          {refreshState === "idle" && <RefreshCw className="h-3 w-3" />}
                          {refreshState === "loading" && <RefreshCw className="h-3 w-3 animate-spin" style={{ animationDuration: "1.4s" }} />}
                          {refreshState === "done" && <Check className="h-3 w-3" />}
                          {refreshState === "error" && <X className="h-3 w-3" />}
                        </button>

                        {/* Mode picker chevron */}
                        {refreshState === "idle" && (
                          <button
                            type="button"
                            onClick={(e) => {
                              e.preventDefault()
                              e.stopPropagation()
                              setModeMenuOpen((o) => !o)
                            }}
                            className="flex h-4 w-3.5 shrink-0 items-center justify-center rounded text-muted-foreground hover:text-foreground transition-colors"
                            aria-label="Choose refresh mode"
                          >
                            <ChevronDown className="h-2.5 w-2.5" />
                          </button>
                        )}

                        {/* Dropdown */}
                        {modeMenuOpen && (
                          <div className="absolute left-0 top-full mt-1 z-50 w-44 rounded-lg border border-border bg-card shadow-xl py-1">
                            {(["prune", "scrape"] as const).map((m) => (
                              <button
                                key={m}
                                type="button"
                                onClick={(e) => {
                                  e.preventDefault()
                                  e.stopPropagation()
                                  triggerRefresh(m)
                                }}
                                className="w-full flex items-center gap-2 px-3 py-2 text-xs text-left text-foreground transition-colors hover:bg-secondary"
                              >
                                <span className={cn("h-1.5 w-1.5 rounded-full shrink-0", refreshMode === m ? "bg-[#6BBF91]" : "bg-transparent")} />
                                {m === "prune" ? "Prune dead listings" : "Prune + scrape new"}
                              </button>
                            ))}
                          </div>
                        )}

                      </div>
                    </div>
                    <PedestrianToggle
                      checked={layers.kijijiListings}
                      onCheckedChange={(checked) =>
                        onLayersChange({ ...layers, kijijiListings: checked })
                      }
                      ariaLabel="Toggle Kijiji listings source"
                    />
                  </label>
                  {/* Inline progress bar while refreshing */}
                  {refreshState === "loading" && (
                    <div className="mt-1 mb-1.5">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-muted-foreground truncate">{refreshStep}</span>
                        <span className="text-[11px] font-medium text-foreground tabular-nums shrink-0 ml-2">{refreshProgress}%</span>
                      </div>
                      <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                        <div
                          className="h-full rounded-full bg-[#6BBF91] transition-all duration-500 ease-out"
                          style={{ width: `${refreshProgress}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {(refreshState === "done" || refreshState === "error") && refreshMessage && (
                    <p className={cn(
                      "text-[11px] mt-1 mb-0.5",
                      refreshState === "done" ? "text-[#6BBF91]" : "text-red-400"
                    )}>
                      {refreshMessage}
                    </p>
                  )}

                  {kijijiListOpen ? (
                    <div className="ml-7">
                      <KijijiListPanel
                        items={kijijiListItems}
                        savedItems={savedKijijiImports}
                        selectedId={selectedKijijiId}
                        onSelect={onFocusKijijiListing}
                        onRemoveSaved={onRemoveSavedKijiji}
                        onImported={onImportedKijiji}
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
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground dark:text-zinc-400">
              Find your car-free apartment
            </p>
            <a
              href="https://github.com/omarismail-cs/Padestrian"
              target="_blank"
              rel="noopener noreferrer"
              className="shrink-0 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="View source on GitHub"
            >
              <Github className="h-4 w-4" />
            </a>
          </div>
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
