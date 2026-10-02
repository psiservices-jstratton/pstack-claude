import type { InventoryChange } from "./types.ts";

export function summarizeChanges(changes: readonly InventoryChange[]): string[] {
  return changes.map((change) => {
    if (change.kind === "added") return `ADD ${change.sku} ${change.location} +${change.qty}`;
    if (change.kind === "removed") return `REMOVE ${change.sku} ${change.location} -${change.qty}`;
    return `CHANGE ${change.sku} ${change.location} ${change.beforeQty}->${change.afterQty}`;
  });
}
