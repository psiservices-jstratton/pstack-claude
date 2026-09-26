export type StockRow = {
  sku: string;
  qty: number;
  location: string;
};

export type AddedChange = {
  kind: "added";
  sku: string;
  location: string;
  qty: number;
};

export type ChangedChange = {
  kind: "changed";
  sku: string;
  location: string;
  beforeQty: number;
  afterQty: number;
  delta: number;
};

export type RemovedChange = {
  kind: "removed";
  sku: string;
  location: string;
  qty: number;
};

export type InventoryChange = AddedChange | ChangedChange | RemovedChange;
