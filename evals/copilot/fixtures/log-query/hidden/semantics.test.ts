import { test } from "node:test";
import assert from "node:assert/strict";
import { queryLogLines } from "../src/query.ts";

const punctuated = [
  "2026-09-25 INFO service=api user.id=42 path=/v1/a+b note=literal",
  "2026-09-25 INFO service=api userXid=42 path=/v1/aaab note=pattern-only",
  "2026-09-25 INFO service=api user.id=42 path=/v1/a+b note=literal",
  "2026-09-25 INFO service=api user.id=42 path=/v1/axb note=wrong-path",
];

test("punctuation in terms is literal while duplicates remain", () => {
  assert.deepEqual(queryLogLines(punctuated, ["user.id=42", "a+b"]), [punctuated[0], punctuated[2]]);
});

test("a term that is not a valid pattern is still searchable text", () => {
  assert.deepEqual(queryLogLines(["worker (stale) + retry", "worker stale retry"], ["("]), ["worker (stale) + retry"]);
});

test("every term must match the same line", () => {
  assert.deepEqual(queryLogLines(["alpha beta", "alpha", "beta", "ALPHA BETA"], ["alpha", "BETA"]), ["alpha beta", "ALPHA BETA"]);
});
