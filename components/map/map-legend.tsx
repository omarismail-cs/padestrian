"use client"

import { useCallback, useEffect, useRef, useState, type CSSProperties, type PointerEvent } from "react"
import { cn } from "@/lib/utils"

const LEGEND_ITEMS = [
  { src: "/images/house-walkable.png", label: "Walkable", hint: "Grocery and transit" },
  { src: "/images/house-grocery.png?v=amber", label: "Grocery only", hint: "Grocery, but not transit" },
  { src: "/images/house-transit.png", label: "Transit only", hint: "Transit, but not grocery" },
  { src: "/images/house-neither.png", label: "Neither", hint: "Neither grocery nor transit" },
] as const

const CORNERS = ["tl", "tr", "bl", "br"] as const
type Corner = (typeof CORNERS)[number]

const STORAGE_KEY = "padestrian-legend-corner"
const DRAG_THRESHOLD_PX = 4

interface MapLegendProps {
  sidebarOpen: boolean
}

function isCorner(value: string | null): value is Corner {
  return CORNERS.includes(value as Corner)
}

function cornerStyle(corner: Corner, sidebarOpen: boolean): CSSProperties {
  const mapLeft = sidebarOpen ? "calc(20rem + 1rem)" : "1rem"
  // Sit under the collapsed logo / beside the remaining map, not on chrome.
  const topLeftTop = sidebarOpen ? "1rem" : "4.5rem"
  const themeClearance = "4.5rem"
  const attribClearance = "2.75rem"
  const navClearance = "3.5rem"

  switch (corner) {
    case "tl":
      return { top: topLeftTop, left: mapLeft, right: "auto", bottom: "auto" }
    case "tr":
      return { top: themeClearance, right: "1rem", left: "auto", bottom: "auto" }
    case "bl":
      return { bottom: attribClearance, left: mapLeft, right: "auto", top: "auto" }
    case "br":
      return { bottom: attribClearance, right: navClearance, left: "auto", top: "auto" }
  }
}

export function MapLegend({ sidebarOpen }: MapLegendProps) {
  const [corner, setCorner] = useState<Corner>("tl")
  const [dragging, setDragging] = useState(false)
  const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null)
  const [hoverCorner, setHoverCorner] = useState<Corner | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)
  const layerRef = useRef<HTMLDivElement>(null)
  const padRefs = useRef<Partial<Record<Corner, HTMLDivElement | null>>>({})
  const dragOffset = useRef({ x: 0, y: 0 })
  const pointerStart = useRef({ x: 0, y: 0 })
  const didDrag = useRef(false)
  const [padSize, setPadSize] = useState({ w: 268, h: 36 })

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (isCorner(stored)) setCorner(stored)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    const el = cardRef.current
    if (!el) return
    const measure = () => setPadSize({ w: el.offsetWidth, h: el.offsetHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const persist = (next: Corner) => {
    setCorner(next)
    try {
      localStorage.setItem(STORAGE_KEY, next)
    } catch {
      // ignore
    }
  }

  const nearestCorner = useCallback((cx: number, cy: number): Corner => {
    let best: Corner = corner
    let bestDist = Number.POSITIVE_INFINITY
    for (const slot of CORNERS) {
      const el = padRefs.current[slot]
      if (!el) continue
      const r = el.getBoundingClientRect()
      const dx = cx - (r.left + r.width / 2)
      const dy = cy - (r.top + r.height / 2)
      const dist = dx * dx + dy * dy
      if (dist < bestDist) {
        bestDist = dist
        best = slot
      }
    }
    return best
  }, [corner])

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    const card = cardRef.current
    const layer = layerRef.current
    if (!card || !layer) return
    const rect = card.getBoundingClientRect()
    dragOffset.current = {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    }
    pointerStart.current = { x: event.clientX, y: event.clientY }
    didDrag.current = false
    card.setPointerCapture(event.pointerId)
  }

  const layerPoint = (clientX: number, clientY: number) => {
    const layer = layerRef.current
    if (!layer) return { x: clientX, y: clientY }
    const rect = layer.getBoundingClientRect()
    return {
      x: clientX - rect.left - dragOffset.current.x,
      y: clientY - rect.top - dragOffset.current.y,
    }
  }

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const dx = event.clientX - pointerStart.current.x
    const dy = event.clientY - pointerStart.current.y
    if (!didDrag.current && dx * dx + dy * dy < DRAG_THRESHOLD_PX * DRAG_THRESHOLD_PX) {
      return
    }
    didDrag.current = true
    setDragging(true)
    const pos = layerPoint(event.clientX, event.clientY)
    setDragPos(pos)
    const card = cardRef.current
    const w = card?.offsetWidth ?? 0
    const h = card?.offsetHeight ?? 0
    setHoverCorner(nearestCorner(event.clientX - dragOffset.current.x + w / 2, event.clientY - dragOffset.current.y + h / 2))
  }

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (didDrag.current) {
      const card = cardRef.current
      const w = card?.offsetWidth ?? 0
      const h = card?.offsetHeight ?? 0
      persist(
        nearestCorner(
          event.clientX - dragOffset.current.x + w / 2,
          event.clientY - dragOffset.current.y + h / 2,
        ),
      )
    }
    setDragging(false)
    setDragPos(null)
    setHoverCorner(null)
  }

  return (
    <div ref={layerRef} className="pointer-events-none absolute inset-0 z-10 overflow-hidden">
      {CORNERS.map((slot) => (
        <div
          key={slot}
          ref={(el) => {
            padRefs.current[slot] = el
          }}
          className={cn(
            "pointer-events-none absolute rounded-xl border border-dashed transition-all duration-200",
            dragging
              ? hoverCorner === slot
                ? "border-brand/70 bg-brand/10"
                : "border-border/80 bg-card/40"
              : "border-transparent",
          )}
          style={{
            ...cornerStyle(slot, sidebarOpen),
            width: padSize.w,
            height: padSize.h,
          }}
          aria-hidden
        />
      ))}

      <div
        ref={cardRef}
        role="list"
        aria-label="Listing colours. Drag to snap to a corner."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        className={cn(
          "pointer-events-auto absolute flex flex-wrap items-center gap-x-3 gap-y-1.5",
          "rounded-xl border border-border bg-card/95 px-3 py-2 shadow-lg backdrop-blur-xl",
          "select-none touch-none",
          dragging ? "cursor-grabbing shadow-xl" : "cursor-grab",
          !dragging && "transition-[top,right,bottom,left,box-shadow] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]",
        )}
        style={
          dragging && dragPos
            ? { top: dragPos.y, left: dragPos.x, right: "auto", bottom: "auto" }
            : cornerStyle(corner, sidebarOpen)
        }
      >
        <span
          className="mr-0.5 grid grid-cols-2 gap-[2px] text-muted-foreground/50"
          aria-hidden
        >
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="size-[2.5px] rounded-full bg-current" />
          ))}
        </span>
        {LEGEND_ITEMS.map((item) => (
          <div
            key={item.label}
            className="flex items-center gap-1.5"
            role="listitem"
            title={item.hint}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.src}
              alt=""
              width={14}
              height={14}
              className="pointer-events-none h-3.5 w-3.5 shrink-0 object-contain"
            />
            <span className="text-[11px] text-muted-foreground dark:text-zinc-300">
              {item.label}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
