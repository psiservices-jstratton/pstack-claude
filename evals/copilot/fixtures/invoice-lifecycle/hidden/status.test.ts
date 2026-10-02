import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createInvoice, payInvoice, refundInvoice, sendInvoice, voidInvoice } from "../src/invoice.ts";

test("public invoices expose status instead of lifecycle booleans", () => {
  const invoice = createInvoice("inv_shape", "cus", 100);
  assert.equal(invoice.status, "draft");
  for (const flag of ["sent", "paid", "voided", "refunded"]) {
    assert.equal(Object.hasOwn(invoice, flag), false, `${flag} should not be exposed`);
  }
});

test("state rules match the previous lifecycle behavior", () => {
  const sent = sendInvoice(createInvoice("inv_sent", "cus", 100), "2026-05-01T10:00:00.000Z");
  const resent = sendInvoice(sent, "2026-05-02T10:00:00.000Z");
  assert.equal(resent.status, "sent");
  assert.equal(resent.sentAt, "2026-05-01T10:00:00.000Z");

  const paid = payInvoice(sent, "2026-05-03T10:00:00.000Z");
  assert.equal(paid.status, "paid");
  assert.throws(() => voidInvoice(paid, "2026-05-04T10:00:00.000Z"), /cannot void paid invoice/);
  assert.throws(() => refundInvoice(createInvoice("inv_unpaid", "cus", 100), "2026-05-04T10:00:00.000Z"), /cannot refund unpaid invoice/);

  const voided = voidInvoice(createInvoice("inv_void", "cus", 100), "2026-05-05T10:00:00.000Z");
  assert.equal(voided.status, "voided");
  assert.throws(() => payInvoice(voided, "2026-05-06T10:00:00.000Z"), /cannot pay voided invoice/);

  const refunded = refundInvoice(paid, "2026-05-07T10:00:00.000Z");
  assert.equal(refunded.status, "refunded");
});

test("source no longer reads or declares the four lifecycle flags", () => {
  const text = readFileSync("src/invoice.ts", "utf8");
  assert.doesNotMatch(text, /\b(sent|paid|voided|refunded)\s*:\s*boolean\b/);
  assert.doesNotMatch(text, /\.\s*(sent|paid|voided|refunded)\b/);
});
