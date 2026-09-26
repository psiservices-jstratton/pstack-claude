import type { Order, OrderStatus } from "./types.ts";

export type PartnerOrderRow = {
  orderId: string;
  createdAt: string;
  amount: string;
  state: OrderStatus;
};

function centsToDollars(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function toPartnerRows(orders: Order[]): PartnerOrderRow[] {
  return orders.map((order) => ({
    orderId: order.id,
    createdAt: order.createdAt,
    amount: centsToDollars(order.totalCents),
    state: order.status,
  }));
}

export function totalPaidCents(orders: Order[]): number {
  return orders.reduce((sum, order) => order.status === "paid" ? sum + order.totalCents : sum, 0);
}
