import { test } from "node:test";
import assert from "node:assert/strict";
import { formatHelp, stripAnsi } from "../src/index.ts";
import type { Command } from "../src/model.ts";

const commands: Command[] = [
  {
    name: "sync",
    summary: "Synchronize local records with the remote archive before printing the summary",
    flags: [
      { name: "--report", description: "Write a detailed report for every changed record in the selected collection" },
    ],
  },
];

test("wrapped command and flag descriptions stay within the requested width", () => {
  const output = formatHelp(commands, { program: "library", width: 48 });
  const lines = output.trimEnd().split("\n");
  for (const line of lines) assert.ok(stripAnsi(line).length <= 48, line);
  assert.ok(lines.some((line) => stripAnsi(line) === "        remote archive before printing the"));
  assert.ok(lines.some((line) => stripAnsi(line) === "            changed record in the selected"));
});

test("ANSI-colored flag names are preserved as complete escape sequences", () => {
  const output = formatHelp(commands, { width: 42 });
  assert.match(output, /\u001b\[36m--report\u001b\[0m/);
  assert.doesNotMatch(output, /\u001b\[36m\n/);
  assert.doesNotMatch(output, /\u001b\[0\n/);
});

test("a single long word is placed on its own description line", () => {
  const output = formatHelp(
    [{ name: "pack", summary: "Build Supercalifragilisticexpialidocious bundles", flags: [] }],
    { width: 26 },
  );
  const plain = output.split("\n").map(stripAnsi);
  assert.ok(plain.includes("        Supercalifragilisticexpialidocious"));
});
