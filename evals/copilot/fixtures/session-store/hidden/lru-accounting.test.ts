import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/session-store.ts";
import { sessionBytes } from "../src/size.ts";
import type { SessionRecord } from "../src/types.ts";

function record(userId: string, data: string): SessionRecord {
  return { userId, data, updatedAt: 1 };
}

test("get refreshes recency before the next eviction", () => {
  const a = record("a", "aaaa");
  const b = record("b", "bbbb");
  const c = record("c", "cccc");
  const store = new SessionStore(sessionBytes(a) + sessionBytes(b));

  store.set("a", a);
  store.set("b", b);
  assert.deepEqual(store.get("a"), a);
  store.set("c", c);

  assert.deepEqual(store.get("a"), a);
  assert.equal(store.get("b"), undefined);
  assert.deepEqual(store.get("c"), c);
});

test("replacing an existing session does not add its size twice", () => {
  const a = record("a", "same-size");
  const b = record("b", "same-size");
  const store = new SessionStore(sessionBytes(a) + sessionBytes(b));

  store.set("a", a);
  store.set("b", b);
  store.set("a", { ...a });
  store.set("a", { ...a });

  assert.equal(store.sizeBytes, sessionBytes(a) + sessionBytes(b));
  assert.deepEqual(store.get("a"), a);
  assert.deepEqual(store.get("b"), b);
});

test("growing an existing session evicts the true least recently used victim", () => {
  const smallA = record("a", "small");
  const smallB = record("b", "small");
  const smallC = record("c", "small");
  const largeA = record("a", "x".repeat(80));
  const store = new SessionStore(sessionBytes(largeA) + sessionBytes(smallB));

  store.set("a", smallA);
  store.set("c", smallC);
  store.set("b", smallB);
  assert.deepEqual(store.get("b"), smallB);
  store.set("a", largeA);

  assert.deepEqual(store.get("a"), largeA);
  assert.deepEqual(store.get("b"), smallB);
  assert.equal(store.get("c"), undefined);
  assert.equal(store.sizeBytes, sessionBytes(largeA) + sessionBytes(smallB));
});

test("delete and clear remove all accounted bytes after replacements", () => {
  const a = record("a", "steady");
  const b = record("b", "steady");
  const store = new SessionStore(sessionBytes(a) * 4);

  store.set("a", a);
  store.set("a", { ...a });
  assert.equal(store.delete("a"), true);
  assert.equal(store.sizeBytes, 0);
  assert.equal(store.count, 0);

  store.set("b", b);
  store.set("b", { ...b });
  store.clear();
  assert.equal(store.sizeBytes, 0);
  assert.equal(store.count, 0);
});
