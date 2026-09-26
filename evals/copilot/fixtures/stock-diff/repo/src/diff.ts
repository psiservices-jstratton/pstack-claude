import { normalizeLocation, normalizeSku, reportSku, sortKeys, type ItemKey } from "./normalize.ts";
import type { InventoryChange, StockRow } from "./types.ts";

function keyFor(row: StockRow): ItemKey {
  return { sku: reportSku(row.sku), location: normalizeLocation(row.location) };
}

function sameKey(a: ItemKey, b: ItemKey): boolean {
  return normalizeSku(a.sku) === normalizeSku(b.sku) && a.location === b.location;
}

function rowMatches(row: StockRow, key: ItemKey): boolean {
  return normalizeSku(row.sku) === normalizeSku(key.sku) && normalizeLocation(row.location) === key.location;
}

function uniqueKeys(rows: readonly StockRow[]): ItemKey[] {
  const keys: ItemKey[] = [];
  for (const row of rows) {
    const key = keyFor(row);
    if (!keys.some((existing) => sameKey(existing, key))) keys.push(key);
  }
  return keys.sort(sortKeys);
}

function hasKey(keys: readonly ItemKey[], key: ItemKey): boolean {
  return keys.some((existing) => sameKey(existing, key));
}

function quantityFor(rows: readonly StockRow[], key: ItemKey): number {
  let total = 0;
  for (const row of rows) {
    if (rowMatches(row, key)) total += row.qty;
  }
  return total;
}

export function diffInventory(before: readonly StockRow[], after: readonly StockRow[]): InventoryChange[] {
  const beforeKeys = uniqueKeys(before);
  const afterKeys = uniqueKeys(after);
  const added: InventoryChange[] = [];
  const changed: InventoryChange[] = [];
  const removed: InventoryChange[] = [];

  for (const key of afterKeys) {
    const afterQty = quantityFor(after, key);
    if (!hasKey(beforeKeys, key)) {
      added.push({ kind: "added", sku: key.sku, location: key.location, qty: afterQty });
      continue;
    }
    const beforeQty = quantityFor(before, key);
    if (beforeQty !== afterQty) {
      changed.push({ kind: "changed", sku: key.sku, location: key.location, beforeQty, afterQty, delta: afterQty - beforeQty });
    }
  }

  for (const key of beforeKeys) {
    if (!hasKey(afterKeys, key)) {
      removed.push({ kind: "removed", sku: key.sku, location: key.location, qty: quantityFor(before, key) });
    }
  }

  return [...added, ...changed, ...removed];
}
