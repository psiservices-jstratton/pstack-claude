import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionStore } from "../src/session-store.ts";
import { sessionBytes } from "../src/size.ts";
import type { SessionRecord } from "../src/types.ts";

function session(userId: string, data: string): SessionRecord {
  return { userId, data, updatedAt: 1 };
}

test("stores and retrieves sessions with a byte total", () => {
  const record = session("u1", "cart=2");
  const store = new SessionStore(sessionBytes(record) + 10);

  store.set("s1", record);
  assert.deepEqual(store.get("s1"), record);
  assert.equal(store.sizeBytes, sessionBytes(record));
  assert.equal(store.count, 1);
});

test("evicts the oldest session when the budget is exceeded", () => {
  const a = session("a", "aaaa");
  const b = session("b", "bbbb");
  const c = session("c", "cccc");
  const store = new SessionStore(sessionBytes(a) + sessionBytes(b));

  store.set("a", a);
  store.set("b", b);
  store.set("c", c);
  assert.equal(store.get("a"), undefined);
  assert.deepEqual(store.keys(), ["b", "c"]);
});

test("delete and clear update accounting for normal entries", () => {
  const a = session("a", "aaaa");
  const b = session("b", "bbbb");
  const store = new SessionStore(sessionBytes(a) + sessionBytes(b) + 5);

  store.set("a", a);
  store.set("b", b);
  assert.equal(store.delete("a"), true);
  assert.equal(store.sizeBytes, sessionBytes(b));
  store.clear();
  assert.equal(store.sizeBytes, 0);
  assert.equal(store.count, 0);
});
