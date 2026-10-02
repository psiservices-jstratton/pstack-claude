import { test } from "node:test";
import assert from "node:assert/strict";
import { collectAllOrders, listOrders } from "../src/feed.ts";
import type { Order } from "../src/types.ts";

const orders: Order[] = [
  { id: "ord-3", createdAt: "2026-04-01T10:02:00.000Z", totalCents: 3000, status: "paid" },
  { id: "ord-1", createdAt: "2026-04-01T10:00:00.000Z", totalCents: 1000, status: "paid" },
  { id: "ord-2", createdAt: "2026-04-01T10:01:00.000Z", totalCents: 2000, status: "refunded" },
];

test("returns the first ascending page and a cursor", () => {
  const page = listOrders(orders, { limit: 2 });
  assert.deepEqual(page.orders.map((order) => order.id), ["ord-1", "ord-2"]);
  assert.equal(typeof page.nextCursor, "string");
});

test("continues after a cursor for distinct timestamps", () => {
  const first = listOrders(orders, { limit: 2 });
  const second = listOrders(orders, { limit: 2, cursor: first.nextCursor });
  assert.deepEqual(second.orders.map((order) => order.id), ["ord-3"]);
  assert.equal(second.nextCursor, undefined);
});

test("supports descending order", () => {
  assert.deepEqual(collectAllOrders(orders, { limit: 1, direction: "desc" }).map((order) => order.id), ["ord-3", "ord-2", "ord-1"]);
});

test("can filter by status", () => {
  assert.deepEqual(collectAllOrders(orders, { limit: 1, status: "paid" }).map((order) => order.id), ["ord-1", "ord-3"]);
});
