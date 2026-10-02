import { decodeCursor, encodeCursor } from "./cursor.ts";
import type { Direction, FeedOptions, Order, OrderPage } from "./types.ts";

function compareByCreatedAt(direction: Direction): (a: Order, b: Order) => number {
  const multiplier = direction === "asc" ? 1 : -1;
  return (a, b) => multiplier * a.createdAt.localeCompare(b.createdAt);
}

function sortedOrders(orders: Order[], options: FeedOptions): Order[] {
  const direction = options.direction ?? "asc";
  return orders
    .filter((order) => !options.status || order.status === options.status)
    .toSorted(compareByCreatedAt(direction));
}

function startAfterCursor(sorted: Order[], cursor: ReturnType<typeof decodeCursor>, direction: Direction): number {
  if (!cursor) return 0;
  const index = sorted.findIndex((order) => direction === "asc" ? order.createdAt > cursor.createdAt : order.createdAt < cursor.createdAt);
  return index === -1 ? sorted.length : index;
}

export function listOrders(orders: Order[], options: FeedOptions): OrderPage {
  const direction = options.direction ?? "asc";
  const sorted = sortedOrders(orders, { ...options, direction });
  const cursor = decodeCursor(options.cursor);
  const start = startAfterCursor(sorted, cursor, direction);
  const page = sorted.slice(start, start + options.limit);
  const last = page.at(-1);
  return {
    orders: page,
    nextCursor: last && sorted.length > start + page.length ? encodeCursor({ createdAt: last.createdAt }) : undefined,
  };
}

export function collectAllOrders(orders: Order[], options: Omit<FeedOptions, "cursor">): Order[] {
  const collected: Order[] = [];
  let cursor: string | undefined;
  do {
    const page = listOrders(orders, { ...options, cursor });
    collected.push(...page.orders);
    cursor = page.nextCursor;
  } while (cursor);
  return collected;
}
