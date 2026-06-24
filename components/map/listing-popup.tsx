import { ExternalLink } from "lucide-react"
import { cn } from "@/lib/utils"
import { isCustomListing } from "@/lib/custom-listing"

type WalkabilityBadge = "walkable" | "grocery" | "transit" | "neither"

const BADGE_CLASS: Record<WalkabilityBadge, string> = {
  walkable:
    "bg-[#6BBF91]/15 text-[#3d8f5f] dark:bg-[#132218] dark:text-[#6BBF91]",
  grocery:
    "bg-lime-500/15 text-lime-700 dark:bg-[#1a2112] dark:text-[#a3e635]",
  transit:
    "bg-violet-500/15 text-violet-700 dark:bg-[#221430] dark:text-[#D8B4FE]",
  neither:
    "bg-zinc-200 text-zinc-600 dark:bg-[#18181b] dark:text-[#A1A1AA]",
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
  if (source === "kijiji" || source === "kijiji-saved" || id.startsWith("kijiji-")) return url

  return null
}

interface ListingPopupCardProps {
  properties: Record<string, unknown>
  showBadge: boolean
}

export function ListingPopupCard({ properties, showBadge }: ListingPopupCardProps) {
  const custom = isCustomListing(properties.source)
  const rent = Number(properties.rent_cad)
  const contactPrice = Boolean(properties.price_contact)
  const showRent = !custom && Number.isFinite(rent) && rent > 0
  const showContact = !custom && !showRent && contactPrice
  const beds = formatBedrooms(properties.bedrooms)
  const baths = formatBathrooms(properties.bathrooms)
  const badge = walkabilityBadge(properties)

  const rawAddress = String(properties.address || properties.title || "").trim()
  const { street, cityLine } = splitAddressLines(
    rawAddress,
    properties.neighborhood != null ? String(properties.neighborhood) : null,
  )

  const unitParts = [beds, baths].filter(Boolean)
  const listingUrl = kijijiListingUrl(properties)

  return (
    <div className="w-max max-w-[min(320px,calc(100vw-2rem))] font-sans">
      {showBadge ? (
        <span
          className={cn(
            "mb-4 inline-block rounded-md px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-[0.12em]",
            BADGE_CLASS[badge],
          )}
        >
          {badge === "walkable"
            ? "WALKABLE"
            : badge === "grocery"
              ? "GROCERY ONLY"
              : badge === "transit"
                ? "TRANSIT ONLY"
                : "NOT WALKABLE"}
        </span>
      ) : null}

      {showRent ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xl font-bold tracking-tight text-foreground">
            ${rent.toLocaleString()}
          </span>
          <span className="text-sm font-normal text-muted-foreground">/mo</span>
          {unitParts.length > 0 ? (
            <span className="text-sm font-normal text-muted-foreground">
              · {unitParts.join(" · ")}
            </span>
          ) : null}
        </div>
      ) : showContact ? (
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xl font-bold tracking-tight text-foreground">Contact</span>
          <span className="text-sm font-normal text-muted-foreground">for price</span>
          {unitParts.length > 0 ? (
            <span className="text-sm font-normal text-muted-foreground">
              · {unitParts.join(" · ")}
            </span>
          ) : null}
        </div>
      ) : null}

      {(street || cityLine) && (
        <>
          {showRent || showContact ? (
            <hr className="my-5 border-0 border-t border-border" />
          ) : showBadge ? (
            <hr className="my-4 border-0 border-t border-border" />
          ) : null}
          <div
            className={cn(
              "space-y-1.5 text-sm leading-relaxed text-muted-foreground",
              listingUrl ? "" : "pb-0.5",
            )}
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
          className="listing-popup-cta mt-5"
        >
          View listing
          <ExternalLink width={12} height={12} aria-hidden />
        </a>
      ) : null}
    </div>
  )
}
