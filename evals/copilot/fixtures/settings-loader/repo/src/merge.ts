import type { Settings } from "./schema.ts";

function isRecord(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function mergeSettings(base: Settings, override: Settings): Settings {
  const result: Settings = { ...base };
  for (const [key, value] of Object.entries(override)) {
    const current = result[key];
    result[key] = isRecord(current) && isRecord(value) ? mergeSettings(current, value) : value;
  }
  return result;
}
