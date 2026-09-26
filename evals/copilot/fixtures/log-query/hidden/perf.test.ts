import { test } from "node:test";
import assert from "node:assert/strict";
import { queryLogLines } from "../src/query.ts";

function buildLines(count: number): string[] {
  const ordinary =
    "2026-09-25T12:00:00Z INFO tenant=northwind status=timeout shard-07 phase=checkout region=west service=orders channel=api worker=importer request=ordinary account=shared ordinary message=finished background reconciliation";
  const lines = new Array<string>(count).fill(ordinary);
  for (const index of [0, 1_234_567, 2_469_134]) {
    lines[index] =
      `2026-09-25T12:${String(index % 60).padStart(2, "0")}:00Z INFO tenant=northwind status=timeout shard-07 phase=checkout region=west service=orders channel=api worker=importer request=${index} account=${index % 997} needle final-match message=finished background reconciliation`;
  }
  return lines;
}

test("large multi-term log search is quick", () => {
  const lines = buildLines(5_000_000);
  const start = performance.now();
  const result = queryLogLines(lines, [
    "northwind",
    "timeout",
    "shard-07",
    "checkout",
    "region=west",
    "service=orders",
    "channel=api",
    "worker=importer",
    "request=",
    "account=",
    "needle",
    "final-match",
  ]);
  const elapsed = performance.now() - start;
  assert.deepEqual(result.map((line) => line.match(/request=(\d+)/)?.[1]), ["0", "1234567", "2469134"]);
  assert.ok(elapsed < 2000, `search took ${Math.round(elapsed)}ms`);
});
