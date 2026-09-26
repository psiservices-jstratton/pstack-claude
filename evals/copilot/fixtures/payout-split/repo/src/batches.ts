import type { Recipient } from "./types.ts";

export type PayoutBatch = {
  id: string;
  amountCents: number;
  recipients: Recipient[];
  createdAt: string;
};

export function batchWeight(batch: PayoutBatch): number {
  return batch.recipients.reduce((sum, recipient) => sum + recipient.weight, 0);
}

export function sortBatches(batches: PayoutBatch[]): PayoutBatch[] {
  return batches.toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
}

export function batchIds(batches: PayoutBatch[]): string[] {
  return sortBatches(batches).map((batch) => batch.id);
}
