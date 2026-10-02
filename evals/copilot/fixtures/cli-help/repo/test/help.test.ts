import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHelp, stripAnsi, visibleLength } from "../src/index.ts";

const expected = [
  "Usage: notes <command> [options]",
  "",
  "Commands:",
  "  publish  Publish the current draft",
  "  list     List recent drafts",
  "",
  "Flags:",
  "  \u001b[36m--dry-run\u001b[0m  Show what would change without saving",
  "  \u001b[36m--tag\u001b[0m      Limit the command to one tag",
  "",
].join("\n");

test("formats the default help text", () => {
  assert.equal(formatHelp(), expected);
});

test("exports helpers for measuring terminal text", () => {
  assert.equal(stripAnsi("\u001b[36m--dry-run\u001b[0m"), "--dry-run");
  assert.equal(visibleLength("\u001b[36m--dry-run\u001b[0m"), 9);
});
