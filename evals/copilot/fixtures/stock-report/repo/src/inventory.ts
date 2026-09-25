export type Item = {
  sku: string;
  name: string;
  warehouse: string;
  qty: number;
};

export const SAMPLE_ITEMS: Item[] = [
  { sku: "BK-100", name: "Brake pads, front", warehouse: "RNO", qty: 42 },
  { sku: "FL-220", name: 'Oil filter 3/4" thread', warehouse: "SLC", qty: 7 },
  { sku: "WP-310", name: "Wiper blade 22in", warehouse: "RNO", qty: 0 },
  { sku: "SP-015", name: "Spark plug (iridium)", warehouse: "BOI", qty: 128 },
];

export function selectItems(items: Item[], warehouse?: string): Item[] {
  const chosen = warehouse ? items.filter((i) => i.warehouse === warehouse.toUpperCase()) : items;
  return [...chosen].sort((a, b) => a.sku.localeCompare(b.sku));
}
