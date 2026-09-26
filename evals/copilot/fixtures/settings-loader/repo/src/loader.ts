import { readJsonFile } from "./files.ts";
import { mergeSettings } from "./merge.ts";
import { defaultSchema, defaultSettings, validateSettings } from "./schema.ts";
import type { Settings, SettingsSchema } from "./schema.ts";

export type LoadOptions = {
  path?: string;
  schema?: SettingsSchema;
  defaults?: Settings;
};

export function loadSettings(options: LoadOptions = {}): Settings {
  const schema = options.schema ?? defaultSchema;
  const defaults = options.defaults ?? defaultSettings;
  const fromFile = readJsonFile(options.path);
  const merged = mergeSettings(defaults, fromFile);
  validateSettings(merged, schema);
  return merged;
}

export function getSetting(settings: Settings, dottedKey: string): unknown {
  return dottedKey.split(".").reduce<unknown>((value, key) => {
    if (typeof value !== "object" || value === null) return undefined;
    return (value as Settings)[key];
  }, settings);
}
