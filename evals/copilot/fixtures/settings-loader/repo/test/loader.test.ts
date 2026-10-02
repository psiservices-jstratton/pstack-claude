import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { loadSettings, getSetting } from "../src/index.ts";

const dataFile = join(process.cwd(), "test", "data", "service.json");

test("loads defaults when no file is provided", () => {
  const settings = loadSettings();
  assert.equal(getSetting(settings, "service.port"), 8080);
  assert.equal(getSetting(settings, "db.host"), "localhost");
});

test("merges the JSON file over defaults", () => {
  const settings = loadSettings({ path: dataFile });
  assert.equal(getSetting(settings, "service.host"), "0.0.0.0");
  assert.equal(getSetting(settings, "service.port"), 9000);
  assert.equal(getSetting(settings, "db.port"), 5432);
  assert.equal(getSetting(settings, "features.signup"), true);
});

test("rejects a setting with the wrong type", () => {
  assert.throws(
    () => loadSettings({ defaults: { service: { host: "x", port: "fast", secure: false }, db: { host: "localhost", port: 5432, ssl: false }, features: { signup: false } } }),
    /service\.port/,
  );
});

test("rejects settings outside the declared schema", () => {
  assert.throws(
    () => loadSettings({ defaults: { service: { host: "x", port: 8080, secure: false, workers: 2 }, db: { host: "localhost", port: 5432, ssl: false }, features: { signup: false } } }),
    /service\.workers/,
  );
});
