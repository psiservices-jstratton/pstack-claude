export type TimeWindow = {
  start: string;
  end: string;
};

const STAMP = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z)/;

export function timestampOf(line: string): string | null {
  return line.match(STAMP)?.[1] ?? null;
}

export function compareTimestamps(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

export function isInsideWindow(line: string, window: TimeWindow): boolean {
  const stamp = timestampOf(line);
  if (!stamp) return false;
  return compareTimestamps(stamp, window.start) >= 0 && compareTimestamps(stamp, window.end) <= 0;
}

export function filterByWindow(lines: readonly string[], window: TimeWindow): string[] {
  return lines.filter((line) => isInsideWindow(line, window));
}

export function firstTimestamp(lines: readonly string[]): string | null {
  for (const line of lines) {
    const stamp = timestampOf(line);
    if (stamp) return stamp;
  }
  return null;
}

export function lastTimestamp(lines: readonly string[]): string | null {
  for (let index = lines.length - 1; index >= 0; index--) {
    const stamp = timestampOf(lines[index]);
    if (stamp) return stamp;
  }
  return null;
}

export function describeWindow(lines: readonly string[]): string {
  const first = firstTimestamp(lines);
  const last = lastTimestamp(lines);
  if (!first || !last) return "no timestamps";
  return `${first}..${last}`;
}

export function splitWindows(lines: readonly string[], size: number): string[][] {
  const groups: string[][] = [];
  for (let index = 0; index < lines.length; index += size) {
    groups.push(lines.slice(index, index + size));
  }
  return groups;
}

export const DEFAULT_WINDOW_SIZE = 100;
