import { test } from "node:test";
import assert from "node:assert/strict";
import { uniqueSlug } from "../src/registry.ts";

test("collisions skip suffixes that are already taken", () => {
  const existing = new Set(["launch-notes", "launch-notes-2"]);
  assert.equal(uniqueSlug("Launch notes", existing), "launch-notes-3");
});

test("a base slug ending in a number still uses the next suffix", () => {
  const existing = new Set(["top-10", "top-10-2"]);
  assert.equal(uniqueSlug("Top 10", existing), "top-10-3");
});

test("truncation reserves room for the collision suffix", () => {
  const title = "abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefghijk";
  const existing = new Set(["abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyzabcdefgh"]);
  const slug = uniqueSlug(title, existing);
  assert.ok(slug.endsWith("-2"));
  assert.equal(slug.length, 60);
});

test("all-symbol titles use the documented fallback and still avoid collisions", () => {
  assert.equal(uniqueSlug("!!!", new Set(["article"])), "article-2");
});
