import { test } from "node:test";
import assert from "node:assert/strict";
import { diffInventory } from "../src/diff.ts";
import type { StockRow } from "../src/types.ts";

function row(sku: string, qty: number, location: string): StockRow {
  return { sku, qty, location };
}

function buildSnapshots(count: number): { before: StockRow[]; after: StockRow[] } {
  const before: StockRow[] = [];
  const after: StockRow[] = [];
  for (let i = 0; i < count; i++) {
    const sku = `sku-${String(i).padStart(5, "0")}`;
    const location = `A${i % 37}`;
    before.push(row(sku, 3, location));
    if (i % 5 === 0) before.push(row(sku.toUpperCase(), 2, location));
    if (i % 11 !== 0) {
      const qty = i % 7 === 0 ? 8 : 3 + (i % 5 === 0 ? 2 : 0);
      after.push(row(` ${sku.toUpperCase()} `, qty, location));
    }
    if (i % 13 === 0) after.push(row(`new-${sku}`, 4, `B${i % 19}`));
  }
  return { before, after };
}

test("large warehouse snapshots diff quickly", () => {
  const { before, after } = buildSnapshots(11_000);
  const start = performance.now();
  const changes = diffInventory(before, after);
  const elapsed = performance.now() - start;
  assert.ok(changes.length > 2_500 && changes.length < 4_500, `unexpected change count ${changes.length}`);
  assert.equal(changes[0].kind, "added");
  assert.equal(changes.at(-1)?.kind, "removed");
  assert.ok(elapsed < 1500, `inventory diff took ${Math.round(elapsed)}ms`);
});
