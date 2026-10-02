export type ReportOptions = {
  format: "table" | "json";
  warehouse?: string;
};

const FORMATS = ["table", "json"] as const;

export function parseReportArgs(args: string[]): ReportOptions {
  const options: ReportOptions = { format: "table" };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--format") {
      const value = args[++i];
      if (!FORMATS.includes(value as ReportOptions["format"])) {
        throw new Error(`Unknown format: ${value}`);
      }
      options.format = value as ReportOptions["format"];
    } else if (arg === "--warehouse") {
      options.warehouse = args[++i];
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}
