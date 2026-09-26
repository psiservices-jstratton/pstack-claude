import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAllOrders } from "../src/feed.ts";
import type { Order } from "../src/types.ts";

function order(id: string, createdAt: string): Order {
  return { id, createdAt, totalCents: 1000, status: "paid" };
}

test("ascending pagination visits every order with shared timestamps exactly once", () => {
  const orders = [
    order("same-05", "2026-06-01T12:00:00.000Z"),
    order("same-02", "2026-06-01T12:00:00.000Z"),
    order("later-01", "2026-06-01T12:01:00.000Z"),
    order("same-04", "2026-06-01T12:00:00.000Z"),
    order("same-01", "2026-06-01T12:00:00.000Z"),
    order("same-03", "2026-06-01T12:00:00.000Z"),
  ];
  assert.deepEqual(collectAllOrders(orders, { limit: 2 }).map((entry) => entry.id), [
    "same-01",
    "same-02",
    "same-03",
    "same-04",
    "same-05",
    "later-01",
  ]);
});

test("descending pagination applies the tie-breaker in descending order too", () => {
  const orders = [
    order("a-1", "2026-06-01T12:00:00.000Z"),
    order("a-3", "2026-06-01T12:00:00.000Z"),
    order("b-1", "2026-06-01T12:01:00.000Z"),
    order("a-2", "2026-06-01T12:00:00.000Z"),
    order("b-2", "2026-06-01T12:01:00.000Z"),
  ];
  assert.deepEqual(collectAllOrders(orders, { limit: 2, direction: "desc" }).map((entry) => entry.id), [
    "b-2",
    "b-1",
    "a-3",
    "a-2",
    "a-1",
  ]);
});

test("many identical timestamps can cross several page boundaries", () => {
  const orders = Array.from({ length: 17 }, (_, index) => order(`burst-${String(index + 1).padStart(2, "0")}`, "2026-07-04T18:30:00.000Z"));
  assert.deepEqual(collectAllOrders(orders.toReversed(), { limit: 4 }).map((entry) => entry.id), orders.map((entry) => entry.id));
});
