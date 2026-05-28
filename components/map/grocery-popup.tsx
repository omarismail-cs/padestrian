const POPUP_FONT =
  "'Satoshi', var(--font-geist), system-ui, sans-serif"

function formatShopCategory(shop: unknown): string {
  const value = String(shop || "supermarket").toLowerCase()
  if (value === "wholesale") return "WHOLESALE"
  if (value === "supermarket") return "SUPERMARKET"
  return value.replace(/_/g, " ").toUpperCase()
}

interface GroceryPopupCardProps {
  properties: Record<string, unknown>
}

export function GroceryPopupCard({ properties }: GroceryPopupCardProps) {
  const name = String(properties.name || properties.brand || "Grocery store").trim()
  const shop = properties.shop

  return (
    <div
      className="min-w-[160px] max-w-[240px] font-sans"
      style={{ fontFamily: POPUP_FONT }}
    >
      <p
        className="text-[15px] font-bold leading-snug tracking-tight"
        style={{ color: "#F4F4F5" }}
      >
        {name}
      </p>
      {shop ? (
        <span
          className="mt-2 inline-block rounded px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.12em]"
          style={{ backgroundColor: "#2A1818", color: "#FCA5A5" }}
        >
          {formatShopCategory(shop)}
        </span>
      ) : null}
    </div>
  )
}
