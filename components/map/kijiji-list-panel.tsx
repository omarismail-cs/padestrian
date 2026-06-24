"use client"

import type { ReactNode } from "react"
import { X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  formatListAddress,
  kijijiListSummary,
  type KijijiListItem,
} from "@/lib/kijiji-listings"
import { KijijiImportForm } from "@/components/map/kijiji-import-form"
import type { Feature, Point } from "geojson"
import { savedKijijiToListItem } from "@/lib/saved-kijiji-imports"

function formatRentLabel(item: KijijiListItem): string | null {
  if (item.rent_cad > 0) return `$${item.rent_cad.toLocaleString()}/mo`
  if (item.properties.price_contact) return "Contact for price"
  return null
}

function walkabilityDotClass(item: {
  eligible: boolean
  near_grocery: boolean
  near_transit: boolean
}): string {
  if (item.eligible) return "bg-[#6BBF91]"
  if (item.near_grocery) return "bg-lime-500"
  if (item.near_transit) return "bg-violet-500"
  return "bg-slate-500"
}

function hiddenHint(item: KijijiListItem): string | null {
  if (item.visibleOnMap) return null
  if (item.hiddenReason === "layer") return "Turn on Kijiji layer"
  return "Hidden by filters"
}

interface KijijiListPanelProps {
  items: KijijiListItem[]
  savedItems: Feature<Point>[]
  selectedId: string | null
  onSelect: (item: KijijiListItem) => void
  onRemoveSaved: (id: string) => void
  onImported: (features: Feature<Point>[]) => void
}

function KijijiListRow({
  item,
  isSelected,
  onSelect,
  trailing,
}: {
  item: KijijiListItem
  isSelected: boolean
  onSelect: (item: KijijiListItem) => void
  trailing?: ReactNode
}) {
  const hint = hiddenHint(item)
  const label = formatListAddress(item.address)
  const rentLabel = formatRentLabel(item)

  return (
    <li className={trailing ? "group flex items-stretch" : undefined}>
      <button
        type="button"
        onClick={() => onSelect(item)}
        aria-current={isSelected ? "true" : undefined}
        aria-label={
          rentLabel
            ? `${label}, ${rentLabel}${hint ? `, ${hint}` : ""}`
            : `${label}${hint ? `, ${hint}` : ""}`
        }
        className={cn(
          "flex min-w-0 items-start gap-2.5 px-3 py-2 text-left transition-colors",
          trailing ? "flex-1" : "w-full",
          item.visibleOnMap ? "hover:bg-secondary/80" : "opacity-55 hover:opacity-75",
          isSelected && "bg-[#6BBF91]/10 ring-1 ring-inset ring-[#6BBF91]/30",
        )}
      >
        <span
          className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", walkabilityDotClass(item))}
          aria-hidden
        />
        <span className="min-w-0 flex-1">
          <span
            className={cn(
              "block truncate text-sm font-medium",
              item.visibleOnMap ? "text-foreground" : "text-muted-foreground",
            )}
          >
            {label}
          </span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
            {rentLabel ? <span>{rentLabel}</span> : null}
            {hint ? <span className="italic">{hint}</span> : null}
          </span>
        </span>
      </button>
      {trailing}
    </li>
  )
}

function SavedLinksList({
  savedItems,
  selectedId,
  onSelect,
  onRemoveSaved,
}: {
  savedItems: Feature<Point>[]
  selectedId: string | null
  onSelect: (item: KijijiListItem) => void
  onRemoveSaved: (id: string) => void
}) {
  if (!savedItems?.length) return null

  const listItems = savedItems.map(savedKijijiToListItem)

  return (
    <div className="mb-2 overflow-hidden rounded-lg border border-border/80 bg-secondary/30">
      <div className="border-b border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        Your saved links ({listItems.length})
      </div>
      <ul className="max-h-36 overflow-y-auto overscroll-contain py-1" aria-label="Saved Kijiji links">
        {listItems.map((item) => {
          const isSelected = selectedId === item.id
          const label = formatListAddress(item.address)
          return (
            <KijijiListRow
              key={item.id}
              item={item}
              isSelected={isSelected}
              onSelect={onSelect}
              trailing={
                <button
                  type="button"
                  onClick={() => onRemoveSaved(item.id)}
                  className="shrink-0 px-2 text-muted-foreground opacity-60 transition-opacity hover:text-foreground hover:opacity-100"
                  aria-label={`Remove saved listing ${label}`}
                >
                  <X className="h-3.5 w-3.5" aria-hidden />
                </button>
              }
            />
          )
        })}
      </ul>
    </div>
  )
}

export function KijijiListPanel({
  items,
  savedItems,
  selectedId,
  onSelect,
  onRemoveSaved,
  onImported,
}: KijijiListPanelProps) {
  const { total, walkable } = kijijiListSummary(items)

  return (
    <div className="mt-2">
      <SavedLinksList
        savedItems={savedItems}
        selectedId={selectedId}
        onSelect={onSelect}
        onRemoveSaved={onRemoveSaved}
      />

      {total === 0 ? (
        <div className="rounded-lg border border-border/80 bg-secondary/30 px-3 py-3">
          <p className="text-xs text-muted-foreground">No Kijiji listings in the catalog.</p>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-border/80 bg-secondary/30">
          <ul
            className="max-h-52 overflow-y-auto overscroll-contain py-1"
            aria-label="Kijiji listings"
          >
            {items.map((item) => (
              <KijijiListRow
                key={item.id}
                item={item}
                isSelected={selectedId === item.id}
                onSelect={onSelect}
              />
            ))}
          </ul>
          <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
            {total} listing{total === 1 ? "" : "s"} · {walkable} walkable
          </div>
        </div>
      )}

      <KijijiImportForm onImported={onImported} />
    </div>
  )
}
