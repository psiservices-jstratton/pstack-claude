import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoice } from "../src/invoice.ts";

const lines = [
  { sku: "A-1", unitPrice: 2_500, quantity: 2 },
  { sku: "B-7", unitPrice: 1_000, quantity: 1 },
];

test("gold customer gets 10% before tax", () => {
  const inv = buildInvoice({ id: "c1", tier: "gold", state: "OR" }, lines, { today: "2026-03-01" });
  assert.equal(inv.subtotal, 6_000);
  assert.equal(inv.discount, 600);
  assert.equal(inv.total, 5_400);
});

test("silver discount needs the minimum subtotal", () => {
  const small = buildInvoice({ id: "c2", tier: "silver", state: "OR" }, [lines[1]], { today: "2026-03-01" });
  assert.equal(small.discount, 0);
  assert.equal(small.discountLabel, "");
});

test("tax applies after the discount", () => {
  const inv = buildInvoice({ id: "c3", tier: "basic", state: "CA" }, lines, { today: "2026-03-01" });
  assert.equal(inv.tax, 435);
  assert.equal(inv.total, 6_435);
});
