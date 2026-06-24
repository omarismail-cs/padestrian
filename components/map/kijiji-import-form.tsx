"use client"

import { useState } from "react"
import type { Feature, Point } from "geojson"
import { cn } from "@/lib/utils"
import { parseImportUrls } from "@/lib/kijiji-import"

interface KijijiImportFormProps {
  onImported: (features: Feature<Point>[]) => void
  disabled?: boolean
}

export function KijijiImportForm({ onImported, disabled }: KijijiImportFormProps) {
  const [text, setText] = useState("")
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle")
  const [message, setMessage] = useState("")

  const handleImport = async () => {
    const urls = parseImportUrls(text, 3)
    if (!urls.length) {
      setState("error")
      setMessage("Paste one or more kijiji.ca listing URLs")
      return
    }

    setState("loading")
    setMessage("")

    try {
      const res = await fetch("/api/import-kijiji", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ urls }),
      })

      const data = (await res.json()) as {
        features?: Feature<Point>[]
        failed?: { url: string; reason: string }[]
        error?: string
      }

      if (!res.ok) {
        setState("error")
        setMessage(data.error ?? "Import failed")
        return
      }

      const features = data.features ?? []
      const failed = data.failed ?? []

      if (features.length) {
        onImported(features)
        setText("")
      }

      if (features.length && !failed.length) {
        setState("done")
        setMessage(
          features.length === 1
            ? "Saved 1 listing on this device"
            : `Saved ${features.length} listings on this device`,
        )
      } else if (features.length && failed.length) {
        setState("done")
        setMessage(
          `Saved ${features.length}; ${failed.length} failed: ${failed[0]?.reason ?? "error"}`,
        )
      } else {
        setState("error")
        setMessage(failed[0]?.reason ?? "Could not import listing")
      }
    } catch (err) {
      setState("error")
      const msg = err instanceof Error ? err.message : "Unknown error"
      setMessage(msg.includes("JSON") ? "Network error — try again" : msg)
    }
  }

  return (
    <div className="mt-3 border-t border-border/60 pt-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">Add a Kijiji link</span>
        <button
          type="button"
          disabled={disabled || state === "loading" || !text.trim()}
          onClick={() => void handleImport()}
          className={cn(
            "rounded-md px-2.5 py-1 text-xs font-medium transition-colors",
            "bg-secondary text-foreground hover:bg-secondary/80",
            "disabled:pointer-events-none disabled:opacity-50",
          )}
        >
          {state === "loading" ? "Importing…" : "Import"}
        </button>
      </div>
      <textarea
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          if (state !== "idle") setState("idle")
        }}
        placeholder="https://www.kijiji.ca/v-apartments-condos/ottawa/…"
        rows={2}
        disabled={disabled || state === "loading"}
        className={cn(
          "mt-2 w-full resize-none rounded-md border border-border/80 bg-background/60 px-2.5 py-2",
          "text-xs text-foreground placeholder:text-muted-foreground/70",
          "focus:outline-none focus:ring-1 focus:ring-brand/40",
          "disabled:opacity-60",
        )}
        aria-label="Kijiji listing URLs to import"
      />
      <p className="mt-1.5 text-[10px] text-muted-foreground">
        Saved on this device only. Up to 3 URLs per import.
      </p>
      {message ? (
        <p
          className={cn(
            "mt-1 text-[11px]",
            state === "error" ? "text-red-400" : "text-brand",
          )}
        >
          {message}
        </p>
      ) : null}
    </div>
  )
}
