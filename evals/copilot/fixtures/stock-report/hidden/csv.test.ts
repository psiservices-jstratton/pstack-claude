import { test } from "node:test";
import assert from "node:assert/strict";
import { run } from "../src/cli.ts";

type Item = { sku: string; name: string; warehouse: string; qty: number };

// RFC 4180 reader: quoted fields, doubled quotes, CRLF or LF records.
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"' && field === "") quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const tricky: Item[] = [
  { sku: "ZZ-9", name: "Plain widget", warehouse: "RNO", qty: 3 },
  { sku: "AA-1", name: "Hose, 3/8 inch", warehouse: "SLC", qty: 12 },
  { sku: "MM-5", name: 'Gauge 2" dial "pro"', warehouse: "RNO", qty: 0 },
  { sku: "QQ-2", name: "Kit\nline two", warehouse: "BOI", qty: 1 },
];
const deps = { loadItems: () => tricky };

function csv(args: string[] = []) {
  const out = run(["report", "--format", "csv", ...args], deps);
  const text = out.replace(/^\uFEFF/, "");
  return parseCsv(text.replace(/(\r?\n)+$/, ""));
}

test("header matches the table columns", () => {
  const [header] = csv();
  assert.deepEqual(header.map((h) => h.trim().toLowerCase()), ["sku", "name", "warehouse", "qty"]);
});

test("one row per item, sorted like the table, with exact values", () => {
  const [, ...rows] = csv();
  assert.deepEqual(rows, [
    ["AA-1", "Hose, 3/8 inch", "SLC", "12"],
    ["MM-5", 'Gauge 2" dial "pro"', "RNO", "0"],
    ["QQ-2", "Kit\nline two", "BOI", "1"],
    ["ZZ-9", "Plain widget", "RNO", "3"],
  ]);
});

test("warehouse filter applies to csv", () => {
  const [, ...rows] = csv(["--warehouse", "rno"]);
  assert.deepEqual(rows.map((r) => r[0]), ["MM-5", "ZZ-9"]);
});

test("format flag order does not matter", () => {
  const out = run(["report", "--warehouse", "SLC", "--format", "csv"], deps);
  assert.match(out, /AA-1/);
  assert.doesNotMatch(out, /ZZ-9/);
});

test("existing formats are unchanged", () => {
  const table = run(["report"], deps).split("\n");
  assert.match(table[0], /^SKU\s+Name\s+Warehouse\s+Qty$/);
  assert.equal(JSON.parse(run(["report", "--format", "json"], deps)).count, 4);
  assert.throws(() => run(["report", "--format", "xml"], deps), /Unknown format: xml/);
});
