import { test } from "node:test";
import assert from "node:assert/strict";
import { createPaymentsClient } from "../src/clients/payments.ts";
import { createShippingClient } from "../src/clients/shipping.ts";
import { createTaxClient } from "../src/clients/tax.ts";
import type { HttpResponse } from "../src/http.ts";

const ok = (status: number, body: unknown): HttpResponse => ({ status, headers: {}, body });
const noSleep = async () => {};

test("shipping returns a quote", async () => {
  const client = createShippingClient({ http: async () => ok(200, { cents: 899 }), sleep: noSleep });
  assert.equal(await client.quote({ weightGrams: 500, toZip: "89501" }), 899);
});

test("payments returns the charge id", async () => {
  const client = createPaymentsClient({ http: async () => ok(201, { id: "ch_1" }), sleep: noSleep });
  assert.equal(await client.charge("cus_1", 1_000), "ch_1");
});

test("tax returns the rate", async () => {
  const client = createTaxClient({ http: async () => ok(200, { rate: 0.0725 }), sleep: noSleep });
  assert.equal(await client.rate("94105"), 0.0725);
});

test("shipping retries a 502 once and succeeds", async () => {
  const replies = [ok(502, null), ok(200, { cents: 450 })];
  const client = createShippingClient({ http: async () => replies.shift()!, sleep: noSleep });
  assert.equal(await client.quote({ weightGrams: 100, toZip: "10001" }), 450);
});
