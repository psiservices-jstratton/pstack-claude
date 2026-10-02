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

// Finds the entry line for `name`, then reads the description back from it and its
// continuation lines, which must start exactly at the description column.
function entry(plain: string[], name: string) {
  const i = plain.findIndex((line) => line.trimStart().startsWith(`${name} `));
  assert.ok(i >= 0, `no line for ${name}`);
  const first = plain[i];
  const col = first.indexOf(name) + name.length + first.slice(first.indexOf(name) + name.length).search(/\S/);
  const parts = [first.slice(col)];
  for (let j = i + 1; j < plain.length && /^ +\S/.test(plain[j]); j++) {
    const indent = plain[j].length - plain[j].trimStart().length;
    if (indent !== col) break;
    parts.push(plain[j].slice(col));
  }
  return { col, parts };
}

test("wrapped command and flag descriptions stay within the requested width", () => {
  const output = formatHelp(commands, { program: "library", width: 48 });
  const plain = output.trimEnd().split("\n").map(stripAnsi);
  for (const line of plain) assert.ok(line.length <= 48, line);
  for (const [name, text] of [["sync", commands[0].summary], ["--report", commands[0].flags[0].description]]) {
    const { parts } = entry(plain, name);
    assert.ok(parts.length > 1, `${name} description was not wrapped`);
    assert.equal(parts.join(" ").replace(/\s+/g, " ").trim(), text, `${name} description lost or reordered words`);
  }
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
  const plain = output.trimEnd().split("\n").map(stripAnsi);
  const { col, parts } = entry(plain, "pack");
  assert.ok(parts.includes("Supercalifragilisticexpialidocious"), JSON.stringify(parts));
  assert.equal(parts.join(" ").replace(/\s+/g, " ").trim(), "Build Supercalifragilisticexpialidocious bundles");
  assert.ok(col > 0);
});
