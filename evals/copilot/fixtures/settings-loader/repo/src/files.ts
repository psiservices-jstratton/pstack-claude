import { existsSync, readFileSync } from "node:fs";
import type { Settings } from "./schema.ts";

export function readJsonFile(path: string | undefined): Settings {
  if (!path || !existsSync(path)) return {};
  const text = readFileSync(path, "utf8").trim();
  if (!text) return {};
  return JSON.parse(text) as Settings;
}
