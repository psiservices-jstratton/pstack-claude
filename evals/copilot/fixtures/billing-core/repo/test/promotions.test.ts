import { test } from "node:test";
import assert from "node:assert/strict";
import { buildInvoice } from "../src/invoice.ts";
import { findPromo } from "../src/promotions.ts";

test("promo codes are case-insensitive and expire", () => {
  assert.equal(findPromo("spring5", "2026-03-01")?.code, "SPRING5");
  assert.equal(findPromo("SPRING5", "2100-01-01"), undefined);
  assert.equal(findPromo(undefined, "2026-03-01"), undefined);
});

test("a promo stacks on the tier discount", () => {
  const inv = buildInvoice(
    { id: "c9", tier: "silver", state: "OR" },
    [{ sku: "A-1", unitPrice: 10_000, quantity: 1 }],
    { promoCode: "LOYAL3", today: "2026-03-01" },
  );
  assert.equal(inv.discount, 800);
  assert.equal(inv.discountLabel, "Silver 5% + LOYAL3");
});
