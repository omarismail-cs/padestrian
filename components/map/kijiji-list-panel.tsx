"use client"

import { cn } from "@/lib/utils"
import {
  formatListAddress,
  kijijiListSummary,
  type KijijiListItem,
} from "@/lib/kijiji-listings"

function walkabilityDotClass(item: KijijiListItem): string {
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
  selectedId: string | null
  onSelect: (item: KijijiListItem) => void
}

export function KijijiListPanel({
  items,
  selectedId,
  onSelect,
}: KijijiListPanelProps) {
  const { total, walkable } = kijijiListSummary(items)

  if (total === 0) {
    return (
      <div className="mt-2 rounded-lg border border-border/80 bg-secondary/30 px-3 py-3">
        <p className="text-xs text-muted-foreground">No Kijiji listings in the dataset.</p>
      </div>
    )
  }

  return (
    <div className="mt-2 overflow-hidden rounded-lg border border-border/80 bg-secondary/30">
      <ul
        className="max-h-52 overflow-y-auto overscroll-contain py-1"
        role="listbox"
        aria-label="Kijiji listings"
      >
        {items.map((item) => {
          const hint = hiddenHint(item)
          const isSelected = selectedId === item.id
          return (
            <li key={item.id} role="option" aria-selected={isSelected}>
              <button
                type="button"
                onClick={() => onSelect(item)}
                className={cn(
                  "flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors",
                  item.visibleOnMap
                    ? "hover:bg-secondary/80"
                    : "opacity-55 hover:opacity-75",
                  isSelected && "bg-[#6BBF91]/10 ring-1 ring-inset ring-[#6BBF91]/30",
                )}
              >
                <span
                  className={cn(
                    "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                    walkabilityDotClass(item),
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">
                  <span
                    className={cn(
                      "block truncate text-sm font-medium",
                      item.visibleOnMap
                        ? "text-foreground"
                        : "text-muted-foreground",
                    )}
                  >
                    {formatListAddress(item.address)}
                  </span>
                  <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {item.rent_cad > 0 ? (
                      <span>${item.rent_cad.toLocaleString()}/mo</span>
                    ) : null}
                    {hint ? <span className="italic">{hint}</span> : null}
                  </span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      <div className="border-t border-border/60 px-3 py-2 text-[11px] text-muted-foreground">
        {total} listing{total === 1 ? "" : "s"} · {walkable} walkable
      </div>
    </div>
  )
}
