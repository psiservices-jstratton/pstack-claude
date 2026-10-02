#!/usr/bin/env node
// Validates fixtures: visible tests pass on the starting code, at least one hidden
// check fails on it, reference.patch (when present) makes every check pass, and no
// candidate-visible file leaks harness vocabulary.
import { spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const fixturesDir = join(here, "fixtures");
const LEAK = /\b(evals?|hidden|fixtures?|benchmarks?|grad(er|ing)|candidates?|pstack|copilot|rubric|harness)\b/i;

function walk(dir, prefix = "") {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules") return [];
    const rel = join(prefix, e.name);
    return e.isDirectory() ? walk(join(dir, e.name), rel) : [rel];
  });
}

function nodeTest(cwd, files) {
  if (!files.length) return { ok: false, failed: ["no test files"], total: 0 };
  const r = spawnSync(process.execPath, ["--test", "--test-reporter=tap", ...files], { cwd, encoding: "utf8", timeout: 180_000 });
  const lines = r.stdout.split("\n");
  const failed = lines.filter((l) => /^\s*not ok \d+ - /.test(l)).map((l) => l.replace(/^\s*not ok \d+ - /, ""));
  const total = lines.filter((l) => /^\s*(not )?ok \d+ - /.test(l)).length;
  return { ok: r.status === 0 && failed.length === 0, failed, total };
}

function check(name) {
  const dir = join(fixturesDir, name);
  const problems = [];
  const prompt = existsSync(join(dir, "prompt.txt")) ? readFileSync(join(dir, "prompt.txt"), "utf8").trim() : "";
  if (!prompt) problems.push("prompt.txt missing or empty");
  if (!existsSync(join(dir, "repo", "package.json"))) problems.push("repo/package.json missing");
  const hiddenFiles = existsSync(join(dir, "hidden")) ? readdirSync(join(dir, "hidden")).filter((f) => f.endsWith(".test.ts")).sort() : [];
  if (!hiddenFiles.length) problems.push("no hidden/*.test.ts");
  if (LEAK.test(prompt)) problems.push(`prompt.txt mentions "${prompt.match(LEAK)[0]}"`);
  for (const rel of existsSync(join(dir, "repo")) ? walk(join(dir, "repo")) : []) {
    if (LEAK.test(rel)) problems.push(`repo path ${rel} mentions "${rel.match(LEAK)[0]}"`);
    const text = readFileSync(join(dir, "repo", rel), "utf8");
    if (LEAK.test(text)) problems.push(`repo/${rel} mentions "${text.match(LEAK)[0]}"`);
  }
  if (problems.length) return { name, problems };

  const work = mkdtempSync(join(tmpdir(), "fx-"));
  try {
    const start = join(work, "start");
    cpSync(join(dir, "repo"), start, { recursive: true });
    const visibleFiles = walk(start).filter((f) => f.endsWith(".test.ts"));
    const visible = nodeTest(start, visibleFiles);
    if (!visible.ok) problems.push(`visible tests fail on the starting code: ${visible.failed.join("; ") || "exit status"}`);
    cpSync(join(dir, "hidden"), join(start, ".hidden"), { recursive: true });
    const hiddenStart = nodeTest(start, hiddenFiles.map((f) => join(".hidden", f)));
    if (hiddenStart.ok) problems.push("every hidden check passes on the starting code");

    let reference = "none";
    if (existsSync(join(dir, "reference.patch"))) {
      const ref = join(work, "ref");
      cpSync(join(dir, "repo"), ref, { recursive: true });
      const applied = spawnSync("git", ["apply", "--whitespace=nowarn", join(dir, "reference.patch")], { cwd: ref, encoding: "utf8" });
      if (applied.status !== 0) problems.push(`reference.patch does not apply: ${applied.stderr.trim()}`);
      else {
        const refVisible = nodeTest(ref, walk(ref).filter((f) => f.endsWith(".test.ts")));
        cpSync(join(dir, "hidden"), join(ref, ".hidden"), { recursive: true });
        const refHidden = nodeTest(ref, hiddenFiles.map((f) => join(".hidden", f)));
        if (!refVisible.ok) problems.push(`visible tests fail with reference.patch: ${refVisible.failed.join("; ")}`);
        if (!refHidden.ok) problems.push(`hidden checks fail with reference.patch: ${refHidden.failed.join("; ")}`);
        reference = `${refHidden.total - refHidden.failed.length}/${refHidden.total}`;
      }
    } else problems.push("reference.patch missing");
    return { name, problems, visible: `${visible.total - visible.failed.length}/${visible.total}`, hiddenStart: `${hiddenStart.total - hiddenStart.failed.length}/${hiddenStart.total}`, reference };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

const names = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(fixturesDir).sort();
let bad = 0;
for (const name of names) {
  const r = check(name);
  const ok = r.problems.length === 0;
  if (!ok) bad++;
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${r.visible ? `  visible ${r.visible}, hidden on start ${r.hiddenStart}, hidden with reference ${r.reference}` : ""}`);
  for (const p of r.problems) console.log(`     - ${p}`);
}
process.exit(bad ? 1 : 0);
