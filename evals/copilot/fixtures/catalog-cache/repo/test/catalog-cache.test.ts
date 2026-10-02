import { test } from "node:test";
import assert from "node:assert/strict";
import { CatalogCache } from "../src/catalog-cache.ts";
import type { CatalogItem } from "../src/types.ts";

function item(id: string, title = id): CatalogItem {
  return { id, title, priceCents: 1000, active: true };
}

test("reuses a completed lookup while it is fresh", async () => {
  let calls = 0;
  const cache = new CatalogCache({
    ttlMs: 1000,
    fetchItem: async (id) => {
      calls++;
      return item(id, `title-${calls}`);
    },
  });

  assert.equal((await cache.getItem("mug")).title, "title-1");
  assert.equal((await cache.getItem("mug")).title, "title-1");
  assert.equal(calls, 1);
});

test("expired entries are loaded again", async () => {
  let now = 10;
  let calls = 0;
  const cache = new CatalogCache({
    ttlMs: 5,
    now: () => now,
    fetchItem: async (id) => {
      calls++;
      return item(id, `version-${calls}`);
    },
  });

  assert.equal((await cache.getItem("tote")).title, "version-1");
  now = 12;
  assert.equal((await cache.getItem("tote")).title, "version-1");
  now = 20;
  assert.equal((await cache.getItem("tote")).title, "version-2");
});

test("getMany keeps input order and ids separate", async () => {
  const cache = new CatalogCache({ ttlMs: 1000, fetchItem: async (id) => item(id) });
  const results = await cache.getMany(["pin", "mug", "pin"]);
  assert.deepEqual(results.map((r) => r.id), ["pin", "mug", "pin"]);
  assert.equal(cache.size, 2);
});
