import type { Feature, Point } from "geojson"
import { NextResponse } from "next/server"
import {
  buildSavedKijijiFeature,
  describeNormalizeFailure,
  fetchKijijiListingRaw,
  normalizeKijijiListing,
  validateKijijiListingUrl,
} from "@/lib/kijiji-import"
import { scorePoint, ScoringDataError } from "@/lib/score-point"

export const maxDuration = 60

const MAX_URLS = 3
const RATE_WINDOW_MS = 60 * 60 * 1000
const RATE_MAX = 10

const rateBuckets = new Map<string, number[]>()

function clientIp(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")
  if (forwarded) return forwarded.split(",")[0]?.trim() || "unknown"
  return request.headers.get("x-real-ip") ?? "unknown"
}

function checkRateLimit(ip: string): boolean {
  const now = Date.now()
  const times = (rateBuckets.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS)
  if (times.length >= RATE_MAX) return false
  times.push(now)
  rateBuckets.set(ip, times)
  return true
}

const ERROR_MESSAGES: Record<string, string> = {
  invalid_url: "Not a valid Kijiji listing URL",
  fetch_failed: "Could not reach Kijiji — try again later",
  listing_not_found: "Listing not found (may be removed)",
  listing_deleted: "Listing was deleted",
  parse_failed: "Could not read listing details from Kijiji",
}

function errorReason(code: string | undefined): string {
  if (!code) return "Import failed"
  if (code.startsWith("http_")) return `Kijiji returned ${code.replace("http_", "")}`
  return ERROR_MESSAGES[code] ?? code
}

export async function POST(request: Request) {
  try {
    return await handleImport(request)
  } catch (err) {
    console.error("import-kijiji failed:", err)
    const message =
      err instanceof ScoringDataError
        ? err.message
        : err instanceof Error
          ? err.message
          : "Import failed"
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

async function handleImport(request: Request) {
  if (process.env.KIJIJI_IMPORT_ENABLED === "false") {
    return NextResponse.json({ error: "Import disabled" }, { status: 503 })
  }

  const ip = clientIp(request)
  if (!checkRateLimit(ip)) {
    return NextResponse.json(
      { error: "Too many import requests — try again in an hour" },
      { status: 429 },
    )
  }

  let urls: string[] = []
  try {
    const body = (await request.json()) as { urls?: unknown }
    if (Array.isArray(body.urls)) {
      urls = body.urls
        .map((u) => (typeof u === "string" ? validateKijijiListingUrl(u) : null))
        .filter((u): u is string => Boolean(u))
    }
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 })
  }

  const unique: string[] = []
  const seen = new Set<string>()
  for (const url of urls) {
    const id = url.match(/\/(\d+)(?:\?|$)/)?.[1]
    if (!id || seen.has(id)) continue
    seen.add(id)
    unique.push(url)
    if (unique.length >= MAX_URLS) break
  }

  if (!unique.length) {
    return NextResponse.json(
      { error: "Provide 1–3 valid kijiji.ca listing URLs" },
      { status: 400 },
    )
  }

  const features: Feature<Point>[] = []
  const failed: { url: string; reason: string }[] = []

  for (const url of unique) {
    const raw = await fetchKijijiListingRaw(url)
    if (raw.error) {
      failed.push({ url, reason: errorReason(raw.error) })
      continue
    }

    const normalized = await normalizeKijijiListing(raw)
    if (!normalized) {
      failed.push({ url, reason: describeNormalizeFailure(raw) })
      continue
    }

    const score = await scorePoint(normalized.lon, normalized.lat, 10)
    features.push(buildSavedKijijiFeature(normalized.row, score))
  }

  return NextResponse.json({ features, failed })
}
