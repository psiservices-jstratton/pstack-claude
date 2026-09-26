import type { CatalogItem, FetchCatalogItem } from "./types.ts";

const ITEMS: Record<string, CatalogItem> = {
  mug: { id: "mug", title: "Stoneware mug", priceCents: 1800, active: true },
  tote: { id: "tote", title: "Canvas tote", priceCents: 2400, active: true },
  pin: { id: "pin", title: "Enamel pin", priceCents: 500, active: false },
};

export function createCatalogFetcher(overrides: Record<string, CatalogItem> = {}): FetchCatalogItem {
  const data = { ...ITEMS, ...overrides };
  return async (id: string) => {
    const item = data[id];
    if (!item) throw new Error(`catalog item not found: ${id}`);
    return { ...item };
  };
}
