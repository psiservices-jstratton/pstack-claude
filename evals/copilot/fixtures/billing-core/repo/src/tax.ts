const RATES: Record<string, number> = { CA: 7.25, NY: 4, OR: 0, TX: 6.25 };

export function taxFor(state: string, taxable: number): number {
  const rate = RATES[state] ?? 0;
  return Math.round((taxable * rate) / 100);
}
