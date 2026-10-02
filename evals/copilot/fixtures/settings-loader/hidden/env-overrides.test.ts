import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadSettings, getSetting } from "../src/index.ts";

function configFile(name: string, body: unknown): string {
  const dir = join(process.cwd(), ".settings-loader-cases");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, JSON.stringify(body), "utf8");
  return path;
}

test("environment overrides beat the JSON file and coerce schema types", () => {
  const path = configFile("override.json", { db: { port: 1111 }, features: { signup: false } });
  const settings = loadSettings({
    path,
    env: { APP_DB__PORT: "6543", APP_FEATURES__SIGNUP: "true", APP_SERVICE__SECURE: "false" },
  });
  assert.equal(getSetting(settings, "db.port"), 6543);
  assert.equal(getSetting(settings, "features.signup"), true);
  assert.equal(getSetting(settings, "service.secure"), false);
});

test("false and zero boolean spellings stay false", () => {
  const settings = loadSettings({ env: { APP_DB__SSL: "0", APP_SERVICE__SECURE: "false" } });
  assert.equal(getSetting(settings, "db.ssl"), false);
  assert.equal(getSetting(settings, "service.secure"), false);
});

test("invalid number overrides fail with the dotted setting name", () => {
  assert.throws(
    () => loadSettings({ env: { APP_DB__PORT: "five thousand" } }),
    (error) => error instanceof Error && error.message.includes("db.port"),
  );
});

test("unknown variables are ignored and schema keys are matched case-insensitively", () => {
  const settings = loadSettings({ env: { app_db__host: "db.internal", APP_DB__POOL: "8" } });
  assert.equal(getSetting(settings, "db.host"), "db.internal");
  assert.equal(getSetting(settings, "db.pool"), undefined);
});
