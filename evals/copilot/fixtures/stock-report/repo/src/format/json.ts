import type { Item } from "../inventory.ts";

export function formatJson(items: Item[]): string {
  return JSON.stringify({ count: items.length, items }, null, 2);
}
