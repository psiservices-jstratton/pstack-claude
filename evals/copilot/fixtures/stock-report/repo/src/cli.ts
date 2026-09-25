import { parseReportArgs } from "./args.ts";
import { formatJson } from "./format/json.ts";
import { formatTable } from "./format/table.ts";
import { type Item, SAMPLE_ITEMS, selectItems } from "./inventory.ts";

export type Deps = { loadItems: () => Item[] };

const defaultDeps: Deps = { loadItems: () => SAMPLE_ITEMS };

export function run(argv: string[], deps: Deps = defaultDeps): string {
  const [command, ...rest] = argv;
  if (command !== "report") {
    throw new Error(`Unknown command: ${command ?? "(none)"}`);
  }
  const options = parseReportArgs(rest);
  const items = selectItems(deps.loadItems(), options.warehouse);
  switch (options.format) {
    case "json":
      return formatJson(items);
    case "table":
      return formatTable(items);
  }
}
