import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogCache } from "../src/catalog-cache.ts";
import type { CatalogItem } from "../src/types.ts";

function item(id: string): CatalogItem {
  return { id, title: id, priceCents: 1000, active: true };
}

test("concurrent reads for the same missing entry share one upstream call", async () => {
  let calls = 0;
  let resolve!: (value: CatalogItem) => void;
  const cache = new CatalogCache({
    ttlMs: 1000,
    fetchItem: (id) => {
      calls++;
      return new Promise<CatalogItem>((done) => {
        resolve = done;
      }).then(() => item(id));
    },
  });

  const reads = [cache.getItem("mug"), cache.getItem("mug"), cache.getItem("mug")];
  assert.equal(calls, 1);
  resolve(item("mug"));
  const results = await Promise.all(reads);
  assert.deepEqual(results.map((r) => r.id), ["mug", "mug", "mug"]);
});

test("a failed load is not reused by the next read", async () => {
  let calls = 0;
  const cache = new CatalogCache({
    ttlMs: 1000,
    fetchItem: async (id) => {
      calls++;
      if (calls === 1) throw new Error("upstream offline");
      return item(id);
    },
  });

  await assert.rejects(cache.getItem("pin"), /offline/);
  assert.equal((await cache.getItem("pin")).id, "pin");
  assert.equal(calls, 2);
});

test("concurrent waiters on a failed load all see the error and the next read retries", async () => {
  let calls = 0;
  const cache = new CatalogCache({
    ttlMs: 1000,
    fetchItem: async (id) => {
      calls++;
      if (calls === 1) throw new Error(`temporary failure for ${id}`);
      return item(id);
    },
  });

  const results = await Promise.allSettled([cache.getItem("tote"), cache.getItem("tote")]);
  assert.equal(calls, 1);
  assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
  assert.equal((await cache.getItem("tote")).id, "tote");
  assert.equal(calls, 2);
});

test("expiry and different ids keep their normal behavior", async () => {
  let now = 0;
  const seen: string[] = [];
  const cache = new CatalogCache({
    ttlMs: 10,
    now: () => now,
    fetchItem: async (id) => {
      seen.push(id);
      return item(`${id}-${seen.length}`);
    },
  });

  assert.equal((await cache.getItem("a")).id, "a-1");
  assert.equal((await cache.getItem("b")).id, "b-2");
  now = 11;
  assert.equal((await cache.getItem("a")).id, "a-3");
  assert.equal((await cache.getItem("b")).id, "b-4");
  assert.deepEqual(seen, ["a", "b", "a", "b"]);
});
