import type { Order, OrderStatus } from "./types.ts";

export type SyncProfile = {
  partnerId: string;
  allowedStatuses: OrderStatus[];
  minimumCents: number;
};

export function orderAllowedForProfile(order: Order, profile: SyncProfile): boolean {
  return profile.allowedStatuses.includes(order.status) && order.totalCents >= profile.minimumCents;
}

export function filterForProfile(orders: Order[], profile: SyncProfile): Order[] {
  return orders.filter((order) => orderAllowedForProfile(order, profile));
}

export function describeProfile(profile: SyncProfile): string {
  const statuses = profile.allowedStatuses.length ? profile.allowedStatuses.join(",") : "none";
  return `${profile.partnerId}:${statuses}:${profile.minimumCents}`;
}
