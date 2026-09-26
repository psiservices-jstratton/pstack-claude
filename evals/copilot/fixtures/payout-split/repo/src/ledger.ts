import type { Share } from "./types.ts";

export type LedgerEntry = {
  accountId: string;
  debitCents: number;
  creditCents: number;
};

export function sharesToLedger(shares: Share[]): LedgerEntry[] {
  return shares.map((share) => ({
    accountId: share.recipientId,
    debitCents: share.cents < 0 ? Math.abs(share.cents) : 0,
    creditCents: share.cents > 0 ? share.cents : 0,
  }));
}

export function netLedgerCents(entries: LedgerEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.creditCents - entry.debitCents, 0);
}
