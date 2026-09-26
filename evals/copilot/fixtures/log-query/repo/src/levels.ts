export type LogLevel = "debug" | "info" | "warn" | "error" | "unknown";

const LEVELS: readonly LogLevel[] = ["debug", "info", "warn", "error"];

export function levelOf(line: string): LogLevel {
  const lower = line.toLowerCase();
  return LEVELS.find((level) => lower.includes(` ${level} `) || lower.startsWith(`${level} `)) ?? "unknown";
}

export function countByLevel(lines: readonly string[]): Record<LogLevel, number> {
  const counts: Record<LogLevel, number> = { debug: 0, info: 0, warn: 0, error: 0, unknown: 0 };
  for (const line of lines) counts[levelOf(line)] += 1;
  return counts;
}
