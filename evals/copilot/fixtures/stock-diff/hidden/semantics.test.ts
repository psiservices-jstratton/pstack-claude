import { test } from "node:test";
import assert from "node:assert/strict";
import { diffInventory } from "../src/diff.ts";
import type { StockRow } from "../src/types.ts";

const row = (sku: string, qty: number, location: string): StockRow => ({ sku, qty, location });

test("trimmed case-insensitive SKUs are summed before comparison", () => {
  const before = [row(" abc-1 ", 2, "North"), row("ABC-1", 3, "North")];
  const after = [row("Abc-1", 10, "North")];
  assert.deepEqual(diffInventory(before, after), [
    { kind: "changed", sku: "ABC-1", location: "North", beforeQty: 5, afterQty: 10, delta: 5 },
  ]);
});

test("same SKU in different locations remains separate", () => {
  const before = [row("X-1", 4, "A"), row("x-1", 6, "B")];
  const after = [row("x-1", 6, "B"), row("X-1", 9, "C")];
  assert.deepEqual(diffInventory(before, after), [
    { kind: "added", sku: "X-1", location: "C", qty: 9 },
    { kind: "removed", sku: "X-1", location: "A", qty: 4 },
  ]);
});

test("groups stay added, changed, removed and each group is sorted", () => {
  const before = [row("m-1", 1, "B"), row("a-1", 1, "A"), row("r-1", 1, "A")];
  const after = [row("z-1", 1, "A"), row("b-1", 1, "A"), row("m-1", 2, "B")];
  assert.deepEqual(diffInventory(before, after).map((change) => `${change.kind}:${change.sku}:${change.location}`), [
    "added:B-1:A",
    "added:Z-1:A",
    "changed:M-1:B",
    "removed:A-1:A",
    "removed:R-1:A",
  ]);
});
