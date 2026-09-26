import type { Share } from "./types.ts";

export type StatementLine = {
  recipientId: string;
  formatted: string;
};

function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  return `${sign}$${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, "0")}`;
}

export function buildStatementLines(shares: Share[]): StatementLine[] {
  return shares.map((share) => ({ recipientId: share.recipientId, formatted: formatCents(share.cents) }));
}

export function statementTotal(shares: Share[]): string {
  return formatCents(shares.reduce((sum, share) => sum + share.cents, 0));
}
