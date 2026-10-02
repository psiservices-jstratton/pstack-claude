import { test } from "node:test";
import assert from "node:assert/strict";
import { diffInventory } from "../src/diff.ts";
import { summarizeChanges } from "../src/format.ts";
import type { StockRow } from "../src/types.ts";

const row = (sku: string, qty: number, location = "A1"): StockRow => ({ sku, qty, location });

test("reports added, changed, and removed groups", () => {
  const before = [row("A-1", 3), row("B-2", 5), row("C-3", 2)];
  const after = [row("A-1", 4), row("B-2", 5), row("D-4", 7)];
  assert.deepEqual(diffInventory(before, after).map((change) => change.kind), ["added", "changed", "removed"]);
});

test("sums duplicate rows for the same SKU and location", () => {
  const changes = diffInventory([row("A-1", 1), row("a-1", 2)], [row("A-1", 5)]);
  assert.deepEqual(changes, [{ kind: "changed", sku: "A-1", location: "A1", beforeQty: 3, afterQty: 5, delta: 2 }]);
});

test("summary renders each change", () => {
  assert.deepEqual(summarizeChanges(diffInventory([], [row("x-1", 2, "Back")])).at(0), "ADD X-1 Back +2");
});
