import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

test("table report lists items sorted by SKU", () => {
  const out = run(["report"]).split("\n");
  assert.match(out[0], /^SKU\s+Name\s+Warehouse\s+Qty$/);
  assert.equal(out.length, 5);
  assert.match(out[1], /^BK-100/);
});

test("json report filters by warehouse", () => {
  const parsed = JSON.parse(run(["report", "--format", "json", "--warehouse", "rno"]));
  assert.equal(parsed.count, 2);
  assert.deepEqual(parsed.items.map((i: { sku: string }) => i.sku), ["BK-100", "WP-310"]);
});

test("unknown formats are rejected", () => {
  assert.throws(() => run(["report", "--format", "xml"]), /Unknown format: xml/);
});
