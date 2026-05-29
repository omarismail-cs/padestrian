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
    <div className="w-full font-sans">
      <p className="text-[15px] font-bold leading-relaxed tracking-tight text-foreground">
        {name}
      </p>
      {shop ? (
        <span className="mt-3 inline-block rounded-md bg-red-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-red-600 dark:bg-[#2A1818] dark:text-[#FCA5A5]">
          {formatShopCategory(shop)}
        </span>
      ) : null}
    </div>
  )
}
