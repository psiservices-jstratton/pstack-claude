import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoice } from "../src/invoice.ts";
import { ruleFor } from "../src/pricing/rules.ts";

const today = "2026-03-01";
const big = [{ sku: "A-1", unitPrice: 10_000, quantity: 1 }];

test("a promo invoice does not change the next invoice without a code", () => {
  buildInvoice({ id: "p1", tier: "gold", state: "OR" }, big, { promoCode: "SPRING5", today });
  const plain = buildInvoice({ id: "p2", tier: "gold", state: "OR" }, big, { today });
  assert.equal(plain.discount, 1_000);
  assert.equal(plain.discountLabel, "Gold 10%");
});

test("repeated promo invoices get the same discount", () => {
  const a = buildInvoice({ id: "r1", tier: "silver", state: "OR" }, big, { promoCode: "LOYAL3", today });
  const b = buildInvoice({ id: "r2", tier: "silver", state: "OR" }, big, { promoCode: "LOYAL3", today });
  const c = buildInvoice({ id: "r3", tier: "silver", state: "OR" }, big, { promoCode: "loyal3", today });
  assert.equal(a.discount, 800);
  assert.equal(b.discount, 800);
  assert.equal(c.discount, 800);
  assert.equal(c.discountLabel, "Silver 5% + LOYAL3");
});

test("the tier rules themselves stay unchanged after promos", () => {
  for (let i = 0; i < 5; i++) {
    buildInvoice({ id: `x${i}`, tier: "gold", state: "OR" }, big, { promoCode: "SPRING5", today });
  }
  assert.equal(ruleFor("gold").percent, 10);
  assert.equal(ruleFor("gold").label, "Gold 10%");
});

test("unknown tiers fall back to no discount even after promos", () => {
  buildInvoice({ id: "u1", tier: "platinum", state: "OR" }, big, { promoCode: "SPRING5", today });
  const inv = buildInvoice({ id: "u2", tier: "bronze", state: "OR" }, big, { today });
  assert.equal(inv.discount, 0);
  assert.equal(inv.discountLabel, "");
});

test("promo invoice totals are right", () => {
  const inv = buildInvoice({ id: "t1", tier: "gold", state: "CA" }, big, { promoCode: "SPRING5", today });
  assert.equal(inv.discount, 1_500);
  assert.equal(inv.tax, 616);
  assert.equal(inv.total, 9_116);
});
