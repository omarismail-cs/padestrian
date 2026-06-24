"use client"

import {
  useState,
  useEffect,
  useRef,
  useCallback,
  type FormEvent,
  type KeyboardEvent,
} from "react"
import { Loader2, MapPin, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import { suggestAddresses, type GeocodeResult } from "@/lib/geocode"

const DEBOUNCE_MS = 280
const MIN_QUERY_LEN = 3

interface AddressSearchProps {
  walkMinutes: number
  hasCustomListing: boolean
  isChecking: boolean
  error: string | null
  onCheckQuery: (query: string) => void
  onSelectAddress: (result: GeocodeResult) => void
  onClear: () => void
}

export function AddressSearch({
  walkMinutes,
  hasCustomListing,
  isChecking,
  error,
  onCheckQuery,
  onSelectAddress,
  onClear,
}: AddressSearchProps) {
  const [query, setQuery] = useState("")
  const [suggestions, setSuggestions] = useState<GeocodeResult[]>([])
  const [isOpen, setIsOpen] = useState(false)
  const [isLoadingSuggestions, setIsLoadingSuggestions] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = "address-suggestions-list"

  const closeDropdown = useCallback(() => {
    setIsOpen(false)
    setActiveIndex(-1)
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (trimmed.length < MIN_QUERY_LEN) {
      setSuggestions([])
      setIsLoadingSuggestions(false)
      closeDropdown()
      return
    }

    setIsLoadingSuggestions(true)
    const timer = window.setTimeout(async () => {
      try {
        const hits = await suggestAddresses(trimmed, 5)
        setSuggestions(hits)
        setIsOpen(hits.length > 0 || trimmed.length >= MIN_QUERY_LEN)
        setActiveIndex(-1)
      } catch {
        setSuggestions([])
      } finally {
        setIsLoadingSuggestions(false)
      }
    }, DEBOUNCE_MS)

    return () => window.clearTimeout(timer)
  }, [query, closeDropdown])

  useEffect(() => {
    const onPointerDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) {
        closeDropdown()
      }
    }
    document.addEventListener("mousedown", onPointerDown)
    return () => document.removeEventListener("mousedown", onPointerDown)
  }, [closeDropdown])

  const pickSuggestion = useCallback(
    (result: GeocodeResult) => {
      setQuery(result.label)
      closeDropdown()
      onSelectAddress(result)
    },
    [closeDropdown, onSelectAddress],
  )

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed || isChecking) return

    if (activeIndex >= 0 && suggestions[activeIndex]) {
      pickSuggestion(suggestions[activeIndex])
      return
    }

    closeDropdown()
    onCheckQuery(trimmed)
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen && suggestions.length === 0) return

    if (e.key === "ArrowDown") {
      e.preventDefault()
      setIsOpen(true)
      setActiveIndex((i) => (i + 1) % Math.max(suggestions.length, 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActiveIndex((i) =>
        i <= 0 ? suggestions.length - 1 : i - 1,
      )
    } else if (e.key === "Escape") {
      closeDropdown()
    }
  }

  const showDropdown =
    isOpen &&
    query.trim().length >= MIN_QUERY_LEN &&
    (isLoadingSuggestions || suggestions.length > 0 || !isChecking)

  const showEmpty =
    showDropdown && !isLoadingSuggestions && suggestions.length === 0

  return (
    <div className="space-y-2.5" ref={rootRef}>
      <form onSubmit={handleSubmit} className="relative">
        <div
          className={cn(
            "flex items-stretch overflow-hidden rounded-xl border bg-background/80 shadow-sm transition-shadow",
            "border-border focus-within:border-brand/50 focus-within:ring-2 focus-within:ring-brand/20",
            error && "border-red-500/40 focus-within:ring-red-500/15",
          )}
        >
          <div className="flex min-w-0 flex-1 items-center gap-2 pl-3">
            <MapPin
              className="h-4 w-4 shrink-0 text-brand"
              aria-hidden
            />
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setIsOpen(true)
              }}
              onFocus={() => {
                if (query.trim().length >= MIN_QUERY_LEN) setIsOpen(true)
              }}
              onKeyDown={handleKeyDown}
              placeholder="123 Bank St"
              disabled={isChecking}
              autoComplete="off"
              role="combobox"
              aria-expanded={showDropdown}
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={
                activeIndex >= 0 ? `address-suggestion-${activeIndex}` : undefined
              }
              className={cn(
                "min-w-0 flex-1 bg-transparent py-2.5 pr-1 text-sm text-foreground",
                "placeholder:text-muted-foreground focus-visible:outline-none",
              )}
            />
          </div>
          <button
            type="submit"
            disabled={isChecking || !query.trim()}
            className={cn(
              "flex shrink-0 items-center gap-1.5 border-l border-border px-3.5 text-sm font-medium",
              "bg-secondary/80 text-foreground hover:bg-secondary",
              "disabled:cursor-not-allowed disabled:opacity-45",
            )}
          >
            {isChecking ? (
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <>
                <Search className="h-3.5 w-3.5 opacity-70" aria-hidden />
                <span>Check</span>
              </>
            )}
          </button>
        </div>

        {showDropdown ? (
          <div
            id={listId}
            role="listbox"
            className={cn(
              "absolute left-0 right-0 top-[calc(100%+6px)] z-50 overflow-hidden",
              "rounded-xl border border-border bg-card/98 shadow-xl backdrop-blur-xl",
            )}
          >
            {isLoadingSuggestions ? (
              <div className="flex items-center gap-2 px-3 py-3 text-xs text-muted-foreground">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-brand" />
                Searching Ottawa addresses…
              </div>
            ) : showEmpty ? (
              <p className="px-3 py-3 text-xs text-muted-foreground">
                No matches—try a full street address.
              </p>
            ) : (
              <ul className="max-h-52 overflow-y-auto py-1">
                {suggestions.map((hit, index) => (
                  <li key={`${hit.label}-${index}`} role="option" aria-selected={activeIndex === index}>
                    <button
                      type="button"
                      id={`address-suggestion-${index}`}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => pickSuggestion(hit)}
                      className={cn(
                        "flex w-full items-start gap-2.5 px-3 py-2.5 text-left text-sm transition-colors",
                        activeIndex === index
                          ? "bg-brand/15 text-foreground"
                          : "text-foreground hover:bg-secondary/80",
                      )}
                    >
                      <MapPin
                        className={cn(
                          "mt-0.5 h-3.5 w-3.5 shrink-0",
                          activeIndex === index
                            ? "text-brand"
                            : "text-muted-foreground",
                        )}
                        aria-hidden
                      />
                      <span className="leading-snug">{hit.label}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}
      </form>

      {hasCustomListing ? (
        <button
          type="button"
          onClick={() => {
            setQuery("")
            setSuggestions([])
            closeDropdown()
            onClear()
          }}
          className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" aria-hidden />
          Clear checked address
        </button>
      ) : null}

      {error ? (
        <p className="text-xs leading-relaxed text-red-600 dark:text-red-400" role="alert">
          {error}
        </p>
      ) : (
        <p className="text-xs leading-relaxed text-muted-foreground dark:text-zinc-400">
          See if a place is within a {walkMinutes}-minute walk of grocery and transit.
        </p>
      )}
    </div>
  )
}
