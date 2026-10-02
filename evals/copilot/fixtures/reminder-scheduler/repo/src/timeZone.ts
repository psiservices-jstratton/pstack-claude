export type LocalParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      calendar: "iso8601",
      numberingSystem: "latn",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function localParts(instant: Date, timeZone: string): LocalParts {
  const values: Record<string, number> = {};
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    if (part.type !== "literal") values[part.type] = Number(part.value);
  }
  return {
    year: values.year,
    month: values.month,
    day: values.day,
    hour: values.hour,
    minute: values.minute,
  };
}

export function advanceLocalDate(parts: Pick<LocalParts, "year" | "month" | "day">, days: number): LocalParts {
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + days, 12, 0));
  return {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: 0,
    minute: 0,
  };
}

export function resolveWallTime(timeZone: string, parts: LocalParts): string {
  const guess = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
  for (let offset = -720; offset <= 720; offset++) {
    const instant = new Date(guess + offset * 60_000);
    const seen = localParts(instant, timeZone);
    if (
      seen.year === parts.year &&
      seen.month === parts.month &&
      seen.day === parts.day &&
      seen.hour === parts.hour &&
      seen.minute === parts.minute
    ) {
      return instant.toISOString();
    }
  }
  return new Date(guess).toISOString();
}
