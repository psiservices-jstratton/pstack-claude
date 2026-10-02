import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { createPaymentsClient } from "../src/clients/payments.ts";
import { createShippingClient } from "../src/clients/shipping.ts";
import { createTaxClient } from "../src/clients/tax.ts";
import type { HttpResponse } from "../src/http.ts";

const res = (status: number, body: unknown = null, headers: Record<string, string> = {}): HttpResponse => ({ status, headers, body });

function harness(replies: (HttpResponse | Error)[]) {
  const sleeps: number[] = [];
  let calls = 0;
  return {
    sleeps,
    get calls() { return calls; },
    deps: {
      http: async () => {
        calls++;
        const next = replies.shift();
        if (next === undefined) throw new Error("no more replies");
        if (next instanceof Error) throw next;
        return next;
      },
      sleep: async (ms: number) => { sleeps.push(ms); },
    },
  };
}

test("shipping: 3 attempts on 5xx with 100/200 backoff", async () => {
  const h = harness([res(500), res(503), res(504)]);
  await assert.rejects(createShippingClient(h.deps).quote({ weightGrams: 1, toZip: "1" }), /status 504/);
  assert.equal(h.calls, 3);
  assert.deepEqual(h.sleeps, [100, 200]);
});

test("shipping: 429 is not retried", async () => {
  const h = harness([res(429)]);
  await assert.rejects(createShippingClient(h.deps).quote({ weightGrams: 1, toZip: "1" }), /status 429/);
  assert.equal(h.calls, 1);
});

test("shipping: network errors are not retried", async () => {
  const h = harness([new Error("ECONNRESET"), res(200, { cents: 1 })]);
  await assert.rejects(createShippingClient(h.deps).quote({ weightGrams: 1, toZip: "1" }), /ECONNRESET/);
  assert.equal(h.calls, 1);
});

test("payments: 5 attempts with 200/400/800/1600 backoff", async () => {
  const h = harness([res(500), res(500), res(502), res(503), res(500)]);
  await assert.rejects(createPaymentsClient(h.deps).charge("c", 1), /payments request failed with status 500/);
  assert.equal(h.calls, 5);
  assert.deepEqual(h.sleeps, [200, 400, 800, 1600]);
});

test("payments: 429 honors retry-after seconds, else backs off", async () => {
  const h = harness([res(429, null, { "retry-after": "3" }), res(429), res(201, { id: "ch_9" })]);
  assert.equal(await createPaymentsClient(h.deps).charge("c", 1), "ch_9");
  assert.deepEqual(h.sleeps, [3000, 400]);
});

test("payments: retry-after on a 503 is ignored", async () => {
  const h = harness([res(503, null, { "retry-after": "9" }), res(201, { id: "ch_2" })]);
  assert.equal(await createPaymentsClient(h.deps).charge("c", 1), "ch_2");
  assert.deepEqual(h.sleeps, [200]);
});

test("payments: 4xx other than 429 is returned, not retried", async () => {
  const h = harness([res(402)]);
  await assert.rejects(createPaymentsClient(h.deps).charge("c", 1), /status 402/);
  assert.equal(h.calls, 1);
});

test("tax: retries 503 and network errors with a fixed 50ms, 3 attempts", async () => {
  const h = harness([res(503), new Error("ETIMEDOUT"), res(200, { rate: 0.05 })]);
  assert.equal(await createTaxClient(h.deps).rate("1"), 0.05);
  assert.deepEqual(h.sleeps, [50, 50]);
});

test("tax: gives up with the last failure", async () => {
  const h = harness([res(503), res(503), new Error("ETIMEDOUT")]);
  await assert.rejects(createTaxClient(h.deps).rate("1"), /ETIMEDOUT/);
  const h2 = harness([new Error("ETIMEDOUT"), res(503), res(503)]);
  await assert.rejects(createTaxClient(h2.deps).rate("1"), /tax request failed with status 503/);
  assert.equal(h2.calls, 3);
});

test("tax: 500 is not retried", async () => {
  const h = harness([res(500)]);
  await assert.rejects(createTaxClient(h.deps).rate("1"), /status 500/);
  assert.equal(h.calls, 1);
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return /\.ts$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

test("one retry loop: client files no longer loop or sleep themselves", () => {
  for (const name of ["shipping.ts", "payments.ts", "tax.ts"]) {
    const text = readFileSync(join("src/clients", name), "utf8");
    assert.doesNotMatch(text, /\b(while|for)\s*\(/, `${name} still has its own loop`);
    assert.doesNotMatch(text, /\bsleep\s*\(/, `${name} still calls sleep`);
  }
  const loopers = sources("src").filter((f) => /\bsleep\s*\(/.test(readFileSync(f, "utf8")) && !f.endsWith("http.ts"));
  assert.equal(loopers.length, 1, `expected one shared helper calling sleep, found: ${loopers.join(", ")}`);
});
