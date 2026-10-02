import { splitPayout } from "./split.ts";
import type { Recipient } from "./types.ts";

export function summarizeSplit(amountCents: number, recipients: Recipient[]): string {
  return splitPayout(amountCents, recipients)
    .map((share) => `${share.recipientId}:${share.cents}`)
    .join(",");
}
