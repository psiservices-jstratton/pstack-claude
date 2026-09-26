import type { Account, DateRange, UsageEvent } from "./types.ts";

function utcDay(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function exportBillingFeed(account: Account, events: UsageEvent[], range: DateRange): string {
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  const buckets = new Map<string, number>();

  for (const event of events) {
    if (event.accountId !== account.id || !event.billable) continue;
    const at = new Date(event.occurredAt).getTime();
    if (at < start || at > end) continue;
    const day = utcDay(event.occurredAt);
    buckets.set(day, (buckets.get(day) ?? 0) + event.units);
  }

  return [...buckets.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, units]) => `${account.id}|${day}|${units}`)
    .join("\n");
}
