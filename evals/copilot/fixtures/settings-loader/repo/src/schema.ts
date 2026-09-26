export type LeafType = "string" | "number" | "boolean";
export type SettingsSchema = { [key: string]: LeafType | SettingsSchema };
export type Settings = Record<string, unknown>;

export const defaultSchema = {
  service: {
    host: "string",
    port: "number",
    secure: "boolean",
  },
  db: {
    host: "string",
    port: "number",
    ssl: "boolean",
  },
  features: {
    signup: "boolean",
  },
} satisfies SettingsSchema;

export const defaultSettings: Settings = {
  service: { host: "127.0.0.1", port: 8080, secure: false },
  db: { host: "localhost", port: 5432, ssl: false },
  features: { signup: false },
};

export function isSchemaObject(node: LeafType | SettingsSchema): node is SettingsSchema {
  return typeof node === "object";
}

function isPlainObject(value: unknown): value is Settings {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function validateSettings(settings: Settings, schema: SettingsSchema = defaultSchema, path: string[] = []): void {
  for (const [key, node] of Object.entries(schema)) {
    const dotted = [...path, key].join(".");
    const value = settings[key];
    if (isSchemaObject(node)) {
      if (!isPlainObject(value)) throw new Error(`${dotted} must be an object`);
      validateSettings(value, node, [...path, key]);
      continue;
    }
    if (typeof value !== node) throw new Error(`${dotted} must be ${node}`);
  }

  for (const key of Object.keys(settings)) {
    if (!(key in schema)) throw new Error(`${[...path, key].join(".")} is not declared`);
  }
}
