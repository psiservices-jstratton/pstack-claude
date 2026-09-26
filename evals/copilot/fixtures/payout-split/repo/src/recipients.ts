import type { Recipient } from "./types.ts";

export function totalWeight(recipients: Recipient[]): number {
  return recipients.reduce((sum, recipient) => sum + recipient.weight, 0);
}

export function assertValidRecipients(recipients: Recipient[]): void {
  for (const recipient of recipients) {
    if (!Number.isFinite(recipient.weight) || recipient.weight < 0) {
      throw new RangeError(`Invalid weight for ${recipient.id}`);
    }
  }
}
