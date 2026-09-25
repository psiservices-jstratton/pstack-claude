import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeContacts } from "../src/dedupe.ts";

const c = (id: string, email: string, phone: string) => ({ id, name: id, email, phone });
const ids = (xs: { id: string }[]) => xs.map((x) => x.id);

test("gmail dots, plus tags, and googlemail collapse", () => {
  const out = dedupeContacts([c("a", "Jo.Smith+crm@gmail.com", ""), c("b", "josmith@googlemail.com", ""), c("c", "jo.smith@example.com", ""), c("d", "josmith@example.com", "")]);
  assert.deepEqual(ids(out), ["a", "c", "d"]);
});

test("only kept rows define duplicates", () => {
  const out = dedupeContacts([c("A", "e1@x.io", "7755550001"), c("B", "e1@x.io", "7755550002"), c("C", "e3@x.io", "7755550002")]);
  assert.deepEqual(ids(out), ["A", "C"]);
});

test("either key matches across different kept rows", () => {
  const out = dedupeContacts([c("A", "e1@x.io", "111"), c("B", "e2@x.io", "222"), c("C", "e2@x.io", "111"), c("D", "", "222"), c("E", "e9@x.io", "")]);
  assert.deepEqual(ids(out), ["A", "B", "E"]);
});

test("blank and whitespace fields never match", () => {
  const out = dedupeContacts([c("A", "", ""), c("B", "  ", " "), c("C", "", "--"), c("D", "d@x.io", "")]);
  assert.deepEqual(ids(out), ["A", "B", "C", "D"]);
});

test("11-digit leading-1 and 10-digit phones match; other 11-digit do not", () => {
  const out = dedupeContacts([c("A", "", "1-775-555-0100"), c("B", "", "775.555.0100"), c("C", "", "27755550100"), c("D", "", "7755550100 ")]);
  assert.deepEqual(ids(out), ["A", "C"]);
});

test("keeps original objects and order", () => {
  const input = [c("x", "q@x.io", ""), c("y", "r@x.io", ""), c("z", "Q@X.IO", "")];
  const out = dedupeContacts(input);
  assert.equal(out[0], input[0]);
  assert.equal(out[1], input[1]);
  assert.equal(out.length, 2);
});
