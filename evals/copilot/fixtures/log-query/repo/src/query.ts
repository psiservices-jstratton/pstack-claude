export type LogSearchOptions = {
  limit?: number;
};

export function normalizeTerms(terms: readonly string[]): string[] {
  return terms.map((term) => term.trim()).filter((term) => term.length > 0);
}

export function queryLogLines(
  lines: readonly string[],
  terms: readonly string[],
  options: LogSearchOptions = {},
): string[] {
  const wanted = normalizeTerms(terms);
  const matches: string[] = [];

  for (const line of lines) {
    let matched = true;
    for (const term of wanted) {
      const pattern = new RegExp(term, "i");
      if (!pattern.test(line)) {
        matched = false;
        break;
      }
    }
    if (matched) {
      matches.push(line);
      if (options.limit !== undefined && matches.length >= options.limit) break;
    }
  }

  return matches;
}
