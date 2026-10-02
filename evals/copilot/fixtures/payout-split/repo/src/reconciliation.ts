import type { Share } from "./types.ts";

export type Reconciliation = {
  expectedCents: number;
  actualCents: number;
  balanced: boolean;
  differenceCents: number;
};

export function reconcileShares(expectedCents: number, shares: Share[]): Reconciliation {
  const actualCents = shares.reduce((sum, share) => sum + share.cents, 0);
  const differenceCents = actualCents - expectedCents;
  return {
    expectedCents,
    actualCents,
    balanced: differenceCents === 0,
    differenceCents,
  };
}

export function describeReconciliation(result: Reconciliation): string {
  if (result.balanced) return `balanced:${result.actualCents}`;
  const sign = result.differenceCents > 0 ? "+" : "";
  return `difference:${sign}${result.differenceCents}`;
}
