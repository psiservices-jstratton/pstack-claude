import type { Order } from "./types.ts";

export type SyncWindow = {
  startsAt?: string;
  endsAt?: string;
};

export function insideWindow(order: Order, window: SyncWindow): boolean {
  if (window.startsAt && order.createdAt < window.startsAt) return false;
  if (window.endsAt && order.createdAt >= window.endsAt) return false;
  return true;
}

export function applyWindow(orders: Order[], window: SyncWindow): Order[] {
  return orders.filter((order) => insideWindow(order, window));
}

export function mergeWindows(a: SyncWindow, b: SyncWindow): SyncWindow {
  return {
    startsAt: [a.startsAt, b.startsAt].filter((value): value is string => value !== undefined).sort().at(-1),
    endsAt: [a.endsAt, b.endsAt].filter((value): value is string => value !== undefined).sort().at(0),
  };
}
