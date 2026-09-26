import type { Account, DateRange, UsageEvent } from "./types.ts";

function localDay(iso: string, offsetMinutes: number): string {
  const shifted = new Date(new Date(iso).getTime() + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function exportUsageCsv(account: Account, events: UsageEvent[], range: DateRange): string {
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  const buckets = new Map<string, Map<string, number>>();

  for (const event of events) {
    if (event.accountId !== account.id) continue;
    const at = new Date(event.occurredAt).getTime();
    if (at < start || at > end) continue;
    const day = localDay(event.occurredAt, account.timezoneOffsetMinutes);
    const products = buckets.get(day) ?? new Map<string, number>();
    products.set(event.product, (products.get(event.product) ?? 0) + event.units);
    buckets.set(day, products);
  }

  const rows = ["day,product,units"];
  for (const day of [...buckets.keys()].sort()) {
    const products = buckets.get(day)!;
    for (const product of [...products.keys()].sort()) {
      rows.push(`${day},${product},${products.get(product)}`);
    }
  }
  return rows.join("\n");
}
