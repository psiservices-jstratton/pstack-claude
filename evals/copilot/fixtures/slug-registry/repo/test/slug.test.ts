import { test } from "node:test";
import assert from "node:assert/strict";
import { articlePath, createArticle, slugify } from "../src/index.ts";

test("normalizes punctuation and accents", () => {
  assert.equal(slugify("Crème brûlée & Café"), "creme-brulee-cafe");
  assert.equal(slugify("Straße updates"), "strasse-updates");
});

test("falls back when no slug characters remain", () => {
  assert.equal(slugify("***"), "article");
});

test("limits slugs without cutting a nearby word", () => {
  assert.equal(slugify("alpha beta gamma delta epsilon", { maxLength: 18 }), "alpha-beta-gamma");
});

test("creates article records with paths", () => {
  const article = createArticle("Roadmap: Q4 / Launch", "body");
  assert.equal(article.slug, "roadmap-q4-launch");
  assert.equal(articlePath(article.slug), "/articles/roadmap-q4-launch");
});
