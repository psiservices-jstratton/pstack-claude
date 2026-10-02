import { test } from "node:test";
import assert from "node:assert/strict";
import { exportBillingFeed } from "../src/billingFeed.ts";
import { exportUsageCsv } from "../src/csv.ts";
import { exportUsageJson } from "../src/json.ts";
import type { Account, UsageEvent } from "../src/types.ts";

const account: Account = { id: "acct_1", timezoneOffsetMinutes: -300, plan: "team" };
const events: UsageEvent[] = [
  { id: "e1", accountId: "acct_1", occurredAt: "2026-01-01T12:00:00.000Z", product: "api", units: 3, billable: true },
  { id: "e2", accountId: "acct_1", occurredAt: "2026-01-01T13:00:00.000Z", product: "storage", units: 2, billable: false },
  { id: "e3", accountId: "acct_2", occurredAt: "2026-01-01T14:00:00.000Z", product: "api", units: 99, billable: true },
];
const range = { start: "2026-01-01T00:00:00.000Z", end: "2026-01-02T00:00:00.000Z" };

test("CSV rolls up by day and product", () => {
  assert.equal(exportUsageCsv(account, events, range), "day,product,units\n2026-01-01,api,3\n2026-01-01,storage,2");
});

test("JSON includes event ids for the account", () => {
  assert.deepEqual(exportUsageJson(account, events, range), {
    accountId: "acct_1",
    days: [{ day: "2026-01-01", totalUnits: 5, eventIds: ["e1", "e2"] }],
  });
});

test("billing feed includes only billable units", () => {
  assert.equal(exportBillingFeed(account, events, range), "acct_1|2026-01-01|3");
});
