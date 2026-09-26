export type ItemKey = {
  sku: string;
  location: string;
};

export function normalizeSku(sku: string): string {
  return sku.trim().toLowerCase();
}

export function reportSku(sku: string): string {
  return sku.trim().toUpperCase();
}

export function normalizeLocation(location: string): string {
  return location.trim();
}

export function sortKeys(a: ItemKey, b: ItemKey): number {
  const bySku = a.sku.localeCompare(b.sku, "en", { sensitivity: "base" });
  return bySku || a.location.localeCompare(b.location);
}
