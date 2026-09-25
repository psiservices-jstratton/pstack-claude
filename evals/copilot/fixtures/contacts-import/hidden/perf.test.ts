import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeContacts } from "../src/dedupe.ts";

const c = (id: string, email: string, phone: string) => ({ id, name: id, email, phone });

function bigExport(n: number) {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const r = rand();
    if (i > 10 && r < 0.1) {
      const j = Math.floor(rand() * i);
      rows.push(c(`r${i}`, `User.${j}+dup@GMAIL.com`, ""));
    } else if (i > 10 && r < 0.2) {
      const j = Math.floor(rand() * i);
      rows.push(c(`r${i}`, `new${i}@corp.example`, `+1 (555) ${String(j).padStart(7, "0")}`));
    } else {
      rows.push(c(`r${i}`, `user${i}@gmail.com`, `555${String(i).padStart(7, "0")}`));
    }
  }
  return rows;
}

test("60k-row export dedupes quickly", () => {
  const rows = bigExport(60_000);
  const start = performance.now();
  const out = dedupeContacts(rows);
  const elapsed = performance.now() - start;
  assert.ok(out.length > 45_000 && out.length < 55_000, `unexpected kept count ${out.length}`);
  assert.ok(elapsed < 1500, `dedupe took ${Math.round(elapsed)}ms`);
});
