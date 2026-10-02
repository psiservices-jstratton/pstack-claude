import { assertValidRecipients, totalWeight } from "./recipients.ts";
import type { Recipient, Share } from "./types.ts";

export function splitPayout(amountCents: number, recipients: Recipient[]): Share[] {
  assertValidRecipients(recipients);
  const weight = totalWeight(recipients);
  if (weight === 0) return recipients.map((recipient) => ({ recipientId: recipient.id, cents: 0 }));

  return recipients.map((recipient) => ({
    recipientId: recipient.id,
    cents: Math.round((amountCents * recipient.weight) / weight),
  }));
}
