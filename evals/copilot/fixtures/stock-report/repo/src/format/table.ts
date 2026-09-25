import type { Item } from "../inventory.ts";

export const COLUMNS: { header: string; value: (item: Item) => string }[] = [
  { header: "SKU", value: (i) => i.sku },
  { header: "Name", value: (i) => i.name },
  { header: "Warehouse", value: (i) => i.warehouse },
  { header: "Qty", value: (i) => String(i.qty) },
];

export function formatTable(items: Item[]): string {
  const rows = [COLUMNS.map((c) => c.header), ...items.map((item) => COLUMNS.map((c) => c.value(item)))];
  const widths = COLUMNS.map((_, col) => Math.max(...rows.map((r) => r[col].length)));
  return rows.map((r) => r.map((cell, col) => cell.padEnd(widths[col])).join("  ").trimEnd()).join("\n");
}
