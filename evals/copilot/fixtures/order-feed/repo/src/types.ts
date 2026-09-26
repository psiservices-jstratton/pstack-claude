export type OrderStatus = "paid" | "refunded" | "cancelled";
export type Direction = "asc" | "desc";

export type Order = {
  id: string;
  createdAt: string;
  totalCents: number;
  status: OrderStatus;
};

export type FeedOptions = {
  limit: number;
  cursor?: string;
  direction?: Direction;
  status?: OrderStatus;
};

export type OrderPage = {
  orders: Order[];
  nextCursor?: string;
};
