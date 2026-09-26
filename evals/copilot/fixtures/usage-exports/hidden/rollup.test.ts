import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { exportBillingFeed } from "../src/billingFeed.ts";
import { exportUsageCsv } from "../src/csv.ts";
import { exportUsageJson } from "../src/json.ts";
import type { Account, UsageEvent } from "../src/types.ts";

const account: Account = { id: "acct_local", timezoneOffsetMinutes: 330, plan: "enterprise" };
const range = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-02T00:00:00.000Z" };
const events: UsageEvent[] = [
  { id: "before", accountId: "acct_local", occurredAt: "2026-01-31T23:59:59.999Z", product: "api", units: 100, billable: true },
  { id: "late", accountId: "acct_local", occurredAt: "2026-02-01T20:30:00.000Z", product: "api", units: 4, billable: true },
  { id: "edge", accountId: "acct_local", occurredAt: "2026-02-02T00:00:00.000Z", product: "api", units: 7, billable: true },
  { id: "free", accountId: "acct_local", occurredAt: "2026-02-01T01:00:00.000Z", product: "storage", units: 9, billable: false },
];

test("each export keeps its existing range and day rules", () => {
  assert.equal(exportUsageCsv(account, events, range), "day,product,units\n2026-02-01,storage,9\n2026-02-02,api,11");
  assert.deepEqual(exportUsageJson(account, events, range), {
    accountId: "acct_local",
    days: [
      { day: "2026-02-01", totalUnits: 9, eventIds: ["free"] },
      { day: "2026-02-02", totalUnits: 4, eventIds: ["late"] },
    ],
  });
  assert.equal(exportBillingFeed(account, events, range), "acct_local|2026-02-01|4\nacct_local|2026-02-02|7");
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("the three exporters use one shared rollup helper", () => {
  for (const name of ["csv.ts", "json.ts", "billingFeed.ts"]) {
    const text = readFileSync(join("src", name), "utf8");
    assert.doesNotMatch(text, /\b(for|while)\s*\(/, `${name} still rolls up events itself`);
    assert.doesNotMatch(text, /new Date\(event\.occurredAt\)/, `${name} still owns date bucketing`);
  }
  const helperFiles = sources("src").filter((file) => {
    const text = readFileSync(file, "utf8");
    return /for \(const event of events\)/.test(text);
  });
  assert.equal(helperFiles.length, 1, `expected one shared event rollup, found ${helperFiles.join(", ")}`);
});
