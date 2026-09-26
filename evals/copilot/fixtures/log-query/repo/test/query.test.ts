import { test } from "node:test";
import assert from "node:assert/strict";
import { queryLogLines } from "../src/query.ts";
import { summarizeMatches } from "../src/report.ts";
import { countByLevel } from "../src/levels.ts";
import { describeWindow, filterByWindow } from "../src/window.ts";

const lines = [
  "2026-09-25T00:00:00Z INFO tenant=acme request=1 loaded profile",
  "2026-09-25T00:00:00Z WARN tenant=acme request=2 retrying import",
  "2026-09-25T00:00:00Z ERROR tenant=beta request=3 retrying import",
  "2026-09-25T00:00:00Z WARN tenant=acme request=2 retrying import",
];

test("matches all terms without changing order", () => {
  assert.deepEqual(queryLogLines(lines, ["tenant=acme", "retrying"]), [lines[1], lines[3]]);
});

test("matching ignores case and blank terms", () => {
  assert.deepEqual(queryLogLines(lines, [" ERROR ", "", "BETA"]), [lines[2]]);
});

test("limit stops after enough matches", () => {
  assert.deepEqual(queryLogLines(lines, ["acme"], { limit: 2 }), [lines[0], lines[1]]);
});

test("summary and level counts use the same line model", () => {
  assert.deepEqual(summarizeMatches(lines, ["retrying"]), { count: 3, first: lines[1], last: lines[3] });
  assert.equal(countByLevel(lines).warn, 2);
});


test("time helpers select inclusive windows", () => {
  const selected = filterByWindow(lines, { start: "2026-09-25T00:00:00Z", end: "2026-09-25T23:59:59Z" });
  assert.equal(selected.length, lines.length);
  assert.equal(describeWindow(selected), "2026-09-25T00:00:00Z..2026-09-25T00:00:00Z");
});
