import type { Account, DateRange, UsageEvent } from "./types.ts";

function localDay(iso: string, offsetMinutes: number): string {
  const shifted = new Date(new Date(iso).getTime() + offsetMinutes * 60_000);
  return shifted.toISOString().slice(0, 10);
}

export function exportUsageJson(account: Account, events: UsageEvent[], range: DateRange) {
  const start = new Date(range.start).getTime();
  const end = new Date(range.end).getTime();
  const buckets = new Map<string, { totalUnits: number; eventIds: string[] }>();

  for (const event of events) {
    if (event.accountId !== account.id) continue;
    const at = new Date(event.occurredAt).getTime();
    if (at < start || at >= end) continue;
    const day = localDay(event.occurredAt, account.timezoneOffsetMinutes);
    const bucket = buckets.get(day) ?? { totalUnits: 0, eventIds: [] };
    bucket.totalUnits += event.units;
    bucket.eventIds.push(event.id);
    buckets.set(day, bucket);
  }

  return {
    accountId: account.id,
    days: [...buckets.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, bucket]) => ({
      day,
      totalUnits: bucket.totalUnits,
      eventIds: bucket.eventIds.sort(),
    })),
  };
}
