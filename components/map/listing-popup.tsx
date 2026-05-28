import { ExternalLink } from "lucide-react"

type WalkabilityBadge = "walkable" | "grocery" | "transit" | "neither"

const POPUP_FONT =
  "'Satoshi', var(--font-geist), system-ui, sans-serif"

/** Secondary copy on the dark popup card (brighter than zinc-500 for readability) */
const POPUP_MUTED = "#A1A1AA"
const POPUP_ADDRESS = "#B4B4BC"

const BADGE_CONFIG: Record<
  WalkabilityBadge,
  { bg: string; text: string; label: string }
> = {
  walkable: { bg: "#132218", text: "#6BBF91", label: "WALKABLE" },
  grocery: { bg: "#1a2112", text: "#a3e635", label: "GROCERY ONLY" },
  transit: { bg: "#221430", text: "#D8B4FE", label: "TRANSIT ONLY" },
  neither: { bg: "#18181b", text: POPUP_MUTED, label: "NOT WALKABLE" },
}

function walkabilityBadge(props: Record<string, unknown>): WalkabilityBadge {
  if (props.eligible) return "walkable"
  if (props.near_grocery) return "grocery"
  if (props.near_transit) return "transit"
  return "neither"
}

function stripNeighborhood(address: string, neighborhood?: string | null): string {
  if (!neighborhood?.trim()) return address.trim()
  const escaped = neighborhood.trim().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
  return address
    .replace(new RegExp(`,\\s*${escaped}\\s*,`, "gi"), ",")
    .replace(new RegExp(`,\\s*${escaped}\\s*$`, "gi"), "")
    .replace(new RegExp(`^${escaped}\\s*,\\s*`, "gi"), "")
    .replace(/,\s*,/g, ",")
    .replace(/^,\s*|\s*,$/g, "")
    .trim()
}

function splitAddressLines(
  address: string,
  neighborhood?: string | null,
): { street: string; cityLine: string } {
  const cleaned = stripNeighborhood(address, neighborhood)
  const parts = cleaned
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length === 0) return { street: address, cityLine: "" }
  if (parts.length === 1) return { street: parts[0], cityLine: "" }

  return {
    street: parts[0],
    cityLine: parts.slice(1).join(", "),
  }
}

function formatBedrooms(bedrooms: unknown): string {
  const n = Number(bedrooms)
  if (n === 0) return "Studio"
  if (!Number.isFinite(n)) return ""
  return `${n} bed${n === 1 ? "" : "s"}`
}

function formatBathrooms(bathrooms: unknown): string | null {
  const n = Number(bathrooms)
  if (!Number.isFinite(n) || n <= 0) return null
  return `${n} bath${n === 1 ? "" : "s"}`

}

function kijijiListingUrl(properties: Record<string, unknown>): string | null {
  const url = String(properties.url ?? "").trim()
  if (!url || !url.includes("kijiji.ca")) return null

  const source = String(properties.source ?? "").toLowerCase()
  const id = String(properties.id ?? "")
  if (source === "kijiji" || id.startsWith("kijiji-")) return url

  return null
}

interface ListingPopupCardProps {
  properties: Record<string, unknown>
  showBadge: boolean
}

export function ListingPopupCard({ properties, showBadge }: ListingPopupCardProps) {
  const rent = Number(properties.rent_cad)
  const beds = formatBedrooms(properties.bedrooms)
  const baths = formatBathrooms(properties.bathrooms)
  const badge = walkabilityBadge(properties)
  const badgeStyle = BADGE_CONFIG[badge]

  const rawAddress = String(properties.address || properties.title || "").trim()
  const { street, cityLine } = splitAddressLines(
    rawAddress,
    properties.neighborhood != null ? String(properties.neighborhood) : null,
  )

  const unitParts = [beds, baths].filter(Boolean)
  const listingUrl = kijijiListingUrl(properties)

  return (
    <div
      className="min-w-[220px] max-w-[280px] font-sans"
      style={{ fontFamily: POPUP_FONT }}
    >
      {showBadge ? (
        <span
          className="mb-3 inline-block rounded px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ backgroundColor: badgeStyle.bg, color: badgeStyle.text }}
        >
          {badgeStyle.label}
        </span>
      ) : null}

      <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
        <span
          className="text-xl font-bold tracking-tight"
          style={{ color: "#F4F4F5" }}
        >
          ${rent.toLocaleString()}
        </span>
        <span className="text-sm font-normal" style={{ color: POPUP_MUTED }}>
          /mo
        </span>
        {unitParts.length > 0 ? (
          <span className="text-sm font-normal" style={{ color: POPUP_MUTED }}>
            · {unitParts.join(" · ")}
          </span>
        ) : null}
      </div>

      {(street || cityLine) && (
        <>
          <hr className="my-4 border-0 border-t border-[#27272A]" />
          <div
            className={`space-y-1 text-sm leading-snug ${listingUrl ? "" : "pb-1"}`}
            style={{ color: POPUP_ADDRESS }}
          >
            {street ? <p>{street}</p> : null}
            {cityLine ? <p>{cityLine}</p> : null}
          </div>
        </>
      )}

      {listingUrl ? (
        <a
          href={listingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="listing-popup-cta mt-3.5"
        >
          View listing
          <ExternalLink width={12} height={12} aria-hidden />
        </a>
      ) : null}
    </div>
  )
}
