import { test } from "node:test";
import assert from "node:assert/strict";
import { createInvoice, invoiceSummary, payInvoice, refundInvoice, sendInvoice, voidInvoice } from "../src/invoice.ts";

test("invoices can be created and sent", () => {
  const invoice = sendInvoice(createInvoice("inv_1", "cus_1", 1200), "2026-05-01T10:00:00.000Z");
  assert.equal(invoice.sentAt, "2026-05-01T10:00:00.000Z");
  assert.deepEqual(invoiceSummary(invoice), { id: "inv_1", customerId: "cus_1", cents: 1200, status: "sent" });
});

test("paid invoices summarize as paid", () => {
  const invoice = payInvoice(sendInvoice(createInvoice("inv_2", "cus_1", 500), "2026-05-01T10:00:00.000Z"), "2026-05-02T10:00:00.000Z");
  assert.deepEqual(invoiceSummary(invoice), { id: "inv_2", customerId: "cus_1", cents: 500, status: "paid" });
});

test("voided invoices cannot be paid", () => {
  const invoice = voidInvoice(createInvoice("inv_3", "cus_2", 700), "2026-05-03T10:00:00.000Z");
  assert.throws(() => payInvoice(invoice, "2026-05-04T10:00:00.000Z"), /cannot pay voided invoice/);
  assert.deepEqual(invoiceSummary(invoice), { id: "inv_3", customerId: "cus_2", cents: 700, status: "voided" });
});

test("refunds mark paid invoices as refunded", () => {
  const invoice = refundInvoice(payInvoice(createInvoice("inv_4", "cus_3", 900), "2026-05-05T10:00:00.000Z"), "2026-05-06T10:00:00.000Z");
  assert.deepEqual(invoiceSummary(invoice), { id: "inv_4", customerId: "cus_3", cents: 900, status: "refunded" });
});
