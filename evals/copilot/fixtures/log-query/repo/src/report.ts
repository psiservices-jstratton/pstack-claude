import { queryLogLines } from "./query.ts";

export type LogSummary = {
  count: number;
  first: string | null;
  last: string | null;
};

export function summarizeMatches(lines: readonly string[], terms: readonly string[]): LogSummary {
  const matches = queryLogLines(lines, terms);
  return {
    count: matches.length,
    first: matches[0] ?? null,
    last: matches.at(-1) ?? null,
  };
}
