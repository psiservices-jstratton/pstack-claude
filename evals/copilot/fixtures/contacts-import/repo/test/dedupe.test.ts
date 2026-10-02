import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeContacts } from "../src/dedupe.ts";
import { prepareImport } from "../src/importer.ts";

const c = (id: string, email: string, phone: string) => ({ id, name: id, email, phone });

test("drops a repeated email regardless of case", () => {
  const out = dedupeContacts([c("a", "Ana@Example.com", ""), c("b", "ana@example.com ", "")]);
  assert.deepEqual(out.map((x) => x.id), ["a"]);
});

test("drops a repeated phone in a different format", () => {
  const out = dedupeContacts([c("a", "", "(775) 555-0100"), c("b", "", "+1 775 555 0100")]);
  assert.deepEqual(out.map((x) => x.id), ["a"]);
});

test("prepareImport reports skipped rows", () => {
  const csv = "id,name,email,phone\n1,Ana,ana@x.io,\n2,Ana B,ANA@x.io,\n3,Bo,bo@x.io,";
  const result = prepareImport(csv);
  assert.equal(result.contacts.length, 2);
  assert.equal(result.skipped, 1);
});
