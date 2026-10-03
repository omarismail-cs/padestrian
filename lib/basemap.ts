export type Basemap = "standard" | "vivid"

export const BASEMAP_OPTIONS: { value: Basemap; label: string }[] = [
  { value: "standard", label: "Standard" },
  { value: "vivid", label: "Vivid" },
]

export const DEFAULT_BASEMAP: Basemap = "standard"

const BASEMAP_STORAGE_KEY = "padestrian:basemap"

function isBasemap(value: unknown): value is Basemap {
  return value === "standard" || value === "vivid"
}

export function loadBasemapFromStorage(): Basemap {
  if (typeof window === "undefined") return DEFAULT_BASEMAP
  try {
    const stored = localStorage.getItem(BASEMAP_STORAGE_KEY)
    return isBasemap(stored) ? stored : DEFAULT_BASEMAP
  } catch {
    return DEFAULT_BASEMAP
  }
}

export function saveBasemapToStorage(basemap: Basemap): void {
  try {
    localStorage.setItem(BASEMAP_STORAGE_KEY, basemap)
  } catch {
    // Storage unavailable (private mode) — choice just won't persist
  }
}
