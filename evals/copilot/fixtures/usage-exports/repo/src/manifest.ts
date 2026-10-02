import type { Account, DateRange } from "./types.ts";

export type ExportKind = "csv" | "json" | "billing";

export type ExportManifest = {
  accountId: string;
  plan: string;
  rangeStart: string;
  rangeEnd: string;
  kind: ExportKind;
  fileName: string;
};

export function buildExportManifest(account: Account, range: DateRange, kind: ExportKind): ExportManifest {
  const start = range.start.slice(0, 10);
  const end = range.end.slice(0, 10);
  return {
    accountId: account.id,
    plan: account.plan,
    rangeStart: range.start,
    rangeEnd: range.end,
    kind,
    fileName: `${account.id}-${start}-${end}.${kind === "billing" ? "feed" : kind}`,
  };
}
