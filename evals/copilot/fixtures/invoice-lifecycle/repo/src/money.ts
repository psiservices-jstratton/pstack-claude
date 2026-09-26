export type Currency = "USD" | "EUR";

export function formatCents(cents: number, currency: Currency = "USD"): string {
  const sign = cents < 0 ? "-" : "";
  const absolute = Math.abs(cents);
  const units = Math.floor(absolute / 100);
  const pennies = `${absolute % 100}`.padStart(2, "0");
  const symbol = currency === "USD" ? "$" : "€";
  return `${sign}${symbol}${units}.${pennies}`;
}

export function addCents(...amounts: number[]): number {
  return amounts.reduce((sum, amount) => sum + amount, 0);
}

export function applyCredit(cents: number, creditCents: number): number {
  if (creditCents < 0) throw new Error("credit must be positive");
  return Math.max(0, cents - creditCents);
}

export function assertPositiveCents(cents: number): void {
  if (!Number.isInteger(cents)) throw new Error("amount must be whole cents");
  if (cents <= 0) throw new Error("amount must be positive");
}
