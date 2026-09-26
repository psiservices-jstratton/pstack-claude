#!/usr/bin/env node
// Blinded A/B harness: plain GitHub Copilot CLI (arm A) against Copilot with the
// pstack plugin installed (arm B). See README.md in this directory.
import { spawn, spawnSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const here = dirname(fileURLToPath(import.meta.url));
const repo = realpathSync(join(here, "../.."));
const fixturesDir = join(here, "fixtures");

const { values: flags } = parseArgs({
  options: {
    tasks: { type: "string", default: readdirSync(fixturesDir).sort().join(",") },
    models: { type: "string", default: "claude-sonnet-5" },
    reps: { type: "string", default: "1" },
    "rep-start": { type: "string", default: "1" },
    arms: { type: "string", default: "A,B" },
    parallel: { type: "string", default: "4" },
    "judge-model": { type: "string", default: "grok-4.7" },
    panel: { type: "string", default: "claude-sonnet-5,grok-4.7" },
    "timeout-min": { type: "string", default: "30" },
    seed: { type: "string", default: String(Date.now() % 100000) },
    out: { type: "string" },
    archive: { type: "string" },
    "no-judge": { type: "boolean", default: false },
    regrade: { type: "string" },
  },
});

const tasks = flags.tasks.split(",").filter(Boolean);
const models = flags.models.split(",").filter(Boolean);
const arms = flags.arms.split(",").filter(Boolean);
const reps = Number(flags.reps);
const repStart = Number(flags["rep-start"]);
const repList = Array.from({ length: reps }, (_, i) => repStart + i);
const timeoutMs = Number(flags["timeout-min"]) * 60_000;
const stamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const outDir = flags.out ?? join(here, "results", stamp);
const archiveDir = flags.archive ?? join(here, "archive", stamp);
mkdirSync(outDir, { recursive: true });

// The candidate-facing root: no harness vocabulary in any path a candidate can see.
const base = realpathSync(mkdtempSync(join(tmpdir(), "ws-")));
const log = (msg) => process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${msg}\n`);

function sh(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, ...opts });
  if (opts.check !== false && r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed (${r.status}): ${r.stderr || r.stdout}`);
  }
  return r;
}

function run(cmd, args, { cwd, env, timeout, stdoutFile }) {
  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], detached: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try { process.kill(-child.pid, "SIGKILL"); } catch { child.kill("SIGKILL"); }
    }, timeout);
    child.on("close", (code) => {
      clearTimeout(timer);
      if (stdoutFile) writeFileSync(stdoutFile, stdout);
      resolve({ code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
  });
}

// Plugin source for arm B: a clean export of HEAD without this harness, so a
// candidate that browses the plugin directory cannot find fixtures or checks.
function exportPlugin() {
  const dest = join(base, "pstack-claude");
  mkdirSync(dest);
  const archive = spawnSync("git", ["-C", repo, "archive", "HEAD"], { maxBuffer: 256 * 1024 * 1024 });
  if (archive.status !== 0) throw new Error(`git archive failed: ${archive.stderr}`);
  sh("tar", ["-x", "-C", dest], { input: archive.stdout });
  rmSync(join(dest, "evals"), { recursive: true, force: true });
  return dest;
}

function modelSheet(candidate) {
  const models = JSON.parse(readFileSync(join(repo, "plugins/pstack/models.json"), "utf8"));
  const panel = [candidate, ...flags.panel.split(",").filter((m) => m && m !== candidate)].slice(0, 3);
  const lines = models.roles.map(({ role, models: tier }) => `${role}: ${tier === "panel" ? panel.join(", ") : candidate}`);
  return `# pstack model configuration\n\n${lines.join("\n")}\n\nsession hook: on\n`;
}

const gitEnv = {
  GIT_AUTHOR_NAME: "Dev", GIT_AUTHOR_EMAIL: "dev@example.com",
  GIT_COMMITTER_NAME: "Dev", GIT_COMMITTER_EMAIL: "dev@example.com",
};

async function prepare(job, pluginDir) {
  const root = realpathSync(mkdtempSync(join(base, "ws-")));
  // Mirror a default install: COPILOT_HOME is the stock $HOME/.copilot.
  const user = join(root, "home");
  const home = join(user, ".copilot");
  const work = join(root, job.task);
  mkdirSync(home, { recursive: true });
  cpSync(join(fixturesDir, job.task, "repo"), work, { recursive: true });
  const env = { ...process.env, ...gitEnv, COPILOT_HOME: home, HOME: user };
  sh("git", ["init", "-q", "-b", "main"], { cwd: work, env });
  sh("git", ["add", "-A"], { cwd: work, env });
  sh("git", ["commit", "-qm", "Initial import"], { cwd: work, env });
  const baseSha = sh("git", ["rev-parse", "HEAD"], { cwd: work, env }).stdout.trim();
  if (job.arm === "B") {
    sh("copilot", ["plugin", "marketplace", "add", pluginDir], { env });
    const out = sh("copilot", ["plugin", "install", "pstack@pstack-claude"], { env }).stdout;
    if (!/Installed \d+ skills/.test(out)) throw new Error(`plugin install failed: ${out}`);
    writeFileSync(join(home, "pstack-models.md"), modelSheet(job.model));
  }
  return { ...job, root, home, work, env, baseSha };
}

async function candidate(job) {
  const prompt = readFileSync(join(fixturesDir, job.task, "prompt.txt"), "utf8").trim();
  log(`start ${job.id}`);
  const r = await run("copilot", ["-s", "--model", job.model, "--allow-all-tools", "--no-ask-user", "-p", prompt], {
    cwd: job.work, env: job.env, timeout: timeoutMs, stdoutFile: join(job.root, "reply.txt"),
  });
  log(`done ${job.id} in ${Math.round(r.ms / 1000)}s${r.timedOut ? " (timed out)" : ""} exit=${r.code}`);
  const sessions = existsSync(join(job.home, "session-state")) ? readdirSync(join(job.home, "session-state")) : [];
  const events = sessions.map((s) => join(job.home, "session-state", s, "events.jsonl")).find(existsSync) ?? null;
  return { ...job, exit: r.code, timedOut: r.timedOut, wallMs: r.ms, events, stderrTail: r.stderr.slice(-2000) };
}

function parseTap(text) {
  const tests = [];
  for (const line of text.split("\n")) {
    const m = /^(not ok|ok) \d+ - (.*?)(?:\s+#.*)?$/.exec(line);
    if (m) tests.push({ name: m[2], ok: m[1] === "ok" });
  }
  return tests;
}

async function nodeTests(cwd, files, env) {
  const results = [];
  for (const file of files) {
    const r = await run(process.execPath, ["--test", "--test-reporter=tap", file], { cwd, env, timeout: 120_000 });
    let tests = parseTap(r.stdout);
    if (r.timedOut) {
      const declared = (readFileSync(join(cwd, file), "utf8").match(/^test\(/gm) ?? []).length;
      tests = Array.from({ length: declared }, (_, i) => ({ name: `${file}#${i + 1} (killed after 120s)`, ok: false }));
    }
    results.push(...tests.map((t) => ({ ...t, file })));
  }
  return results;
}

function listTests(dir, prefix = "") {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    if (e.name === "node_modules" || e.name.startsWith(".")) return [];
    const rel = join(prefix, e.name);
    if (e.isDirectory()) return listTests(join(dir, e.name), rel);
    return /\.test\.ts$/.test(e.name) ? [rel] : [];
  });
}

function diffStats(job) {
  const env = job.env;
  sh("git", ["add", "-A", "-N"], { cwd: job.work, env });
  const numstat = sh("git", ["diff", "--numstat", job.baseSha], { cwd: job.work, env }).stdout.trim();
  const patch = sh("git", ["diff", job.baseSha, "--", ".", ":(exclude)node_modules", ":(exclude)package-lock.json"], { cwd: job.work, env }).stdout;
  const files = numstat ? numstat.split("\n").map((l) => {
    const [add, del, path] = l.split("\t");
    return { path, add: Number(add) || 0, del: Number(del) || 0 };
  }).filter((f) => !f.path.startsWith("node_modules/")) : [];
  const kind = (p) => (/(^|\/)test\/|\.test\.ts$/.test(p) ? "test" : p.startsWith("src/") ? "src" : "other");
  const sum = (k, field) => files.filter((f) => kind(f.path) === k).reduce((n, f) => n + f[field], 0);
  const addedComments = patch.split("\n").filter((l) => /^\+(?!\+\+)\s*(\/\/|\/\*|\*(?!\*\/))/.test(l)).length;
  return {
    filesTouched: files.length,
    files: files.map((f) => ({ ...f, kind: kind(f.path) })),
    srcAdded: sum("src", "add"), srcRemoved: sum("src", "del"),
    testAdded: sum("test", "add"), testRemoved: sum("test", "del"),
    otherFiles: files.filter((f) => kind(f.path) === "other").map((f) => f.path),
    addedCommentLines: addedComments,
    patch,
  };
}

function transcript(job) {
  if (!job.events) return null;
  const events = readFileSync(job.events, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const starts = events.filter((e) => e.type === "tool.execution_start").map((e) => e.data);
  const args = (d) => d.arguments ?? {};
  const bash = starts.filter((d) => d.toolName === "bash").map((d) => String(args(d).command ?? ""));
  const shutdown = events.filter((e) => e.type === "session.shutdown").at(-1)?.data;
  const checkpoint = events.filter((e) => e.type === "session.usage_checkpoint").at(-1)?.data;
  const hook = events.filter((e) => e.type === "hook.end").map((e) => e.data?.output?.additionalContext ?? "").join("\n");
  return {
    toolCounts: starts.reduce((m, d) => ((m[d.toolName] = (m[d.toolName] ?? 0) + 1), m), {}),
    skills: starts.filter((d) => d.toolName === "skill").map((d) => args(d).skill),
    tasks: starts.filter((d) => d.toolName === "task").map((d) => ({ agent_type: args(d).agent_type, model: args(d).model ?? null, mode: args(d).mode ?? null })),
    ranTests: bash.some((c) => /node\s+(--test|.*\.test\.ts)|npm (run )?test|npx tsx|node --experimental/.test(c)),
    viewed: [...new Set(starts.filter((d) => d.toolName === "view").map((d) => String(args(d).path ?? "")))],
    bash,
    routingContext: hook.includes("You have pstack."),
    premiumRequests: shutdown?.totalPremiumRequests ?? checkpoint?.totalPremiumRequests ?? null,
    modelMetrics: shutdown?.modelMetrics ? Object.fromEntries(Object.entries(shutdown.modelMetrics).map(([m, v]) => [m, v.requests])) : null,
    apiMs: shutdown?.totalApiDurationMs ?? null,
  };
}

async function grade(job) {
  const gradeDir = join(job.root, "grade");
  cpSync(job.work, gradeDir, { recursive: true });
  cpSync(join(fixturesDir, job.task, "hidden"), join(gradeDir, ".hidden"), { recursive: true });
  const hiddenFiles = readdirSync(join(gradeDir, ".hidden")).filter((f) => f.endsWith(".test.ts")).sort().map((f) => join(".hidden", f));
  const env = { ...process.env, HOME: join(job.root, "home") };
  const hidden = await nodeTests(gradeDir, hiddenFiles, env);
  const own = await nodeTests(gradeDir, listTests(gradeDir), env);
  const diff = diffStats(job);
  return {
    hidden: { pass: hidden.filter((t) => t.ok).length, total: hidden.length, failed: hidden.filter((t) => !t.ok).map((t) => t.name) },
    ownSuite: { pass: own.filter((t) => t.ok).length, total: own.length },
    diff,
    transcript: transcript(job),
  };
}

async function pool(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i]); } catch (error) { out[i] = { ...items[i], error: String(error?.stack ?? error) }; log(`error ${items[i].id}: ${error}`); }
    }
  }));
  return out;
}

// Seeded shuffle so the label order is reproducible from results.json.
function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

const PLUGIN_TELL = /pstack|\.copilot|COPILOT_HOME|plugin|skills?\//i;

function submission(r) {
  const work = r.work;
  const cmds = (r.grade?.transcript?.bash ?? [])
    .filter((c) => !PLUGIN_TELL.test(c))
    .map((c) => c.split(r.root).join("<workdir-root>").split(work).join("."));
  const patch = r.grade?.diff.patch ?? "";
  return [
    `Project test suite after the change: ${r.grade?.ownSuite.pass}/${r.grade?.ownSuite.total} passing.`,
    "",
    "Shell commands run, in order:",
    "",
    "```text",
    cmds.length ? cmds.map((c) => c.replace(/\n/g, "\n  ")).join("\n") : "(none)",
    "```",
    "",
    "Diff against the starting commit:",
    "",
    "```diff",
    patch.length > 60_000 ? `${patch.slice(0, 60_000)}\n... (truncated)` : patch || "(no changes)",
    "```",
  ].join("\n");
}

const RUBRIC = [
  ["correctness", "Does the change do what the request asks, including edge cases the request implies, without breaking existing behavior?"],
  ["simplicity", "Is it the simplest change that fully works: no needless abstraction, dead code, or indirection?"],
  ["verification", "Did the developer produce real evidence it works (ran tests, added focused tests, measured when speed was the ask)?"],
  ["scope", "Does it stay within what was asked: no unrelated edits, stray files, or drive-by rewrites?"],
];

async function judge(results) {
  const pairs = [];
  const random = rng(Number(flags.seed));
  for (const task of tasks) for (const model of models) for (const rep of repList) {
    const a = results.find((r) => r.task === task && r.model === model && r.rep === rep && r.arm === "A" && r.grade);
    const b = results.find((r) => r.task === task && r.model === model && r.rep === rep && r.arm === "B" && r.grade);
    if (!a || !b) continue;
    const flip = random() < 0.5;
    pairs.push({ id: `P${pairs.length + 1}`, task, model, rep, labels: flip ? { 1: "B", 2: "A" } : { 1: "A", 2: "B" }, runs: flip ? [b, a] : [a, b] });
  }
  if (!pairs.length) return null;
  const packet = [
    "# Code review packet",
    "",
    "Each section below is one change request to a small TypeScript project, followed by two independent submissions from different developers, labeled 1 and 2. Review both submissions on the same scale.",
    "",
    "Score each submission from 1 (poor) to 5 (excellent) on:",
    "",
    ...RUBRIC.map(([k, q]) => `- \`${k}\`: ${q}`),
    "",
    "Then pick the submission you would rather merge (`1`, `2`, or `tie`).",
    "",
    ...pairs.flatMap((p) => [
      `## ${p.id}`,
      "",
      "Request:",
      "",
      `> ${readFileSync(join(fixturesDir, p.task, "prompt.txt"), "utf8").trim()}`,
      "",
      "### Submission 1",
      "",
      submission(p.runs[0]),
      "",
      "### Submission 2",
      "",
      submission(p.runs[1]),
      "",
    ]),
  ].join("\n");
  const judgeRoot = realpathSync(mkdtempSync(join(base, "review-")));
  mkdirSync(join(judgeRoot, "home", ".copilot"), { recursive: true });
  writeFileSync(join(judgeRoot, "packet.md"), packet);
  writeFileSync(join(outDir, "judge-packet.md"), packet);
  const shape = `{"pairs":[{"id":"P1","scores":{"1":{${RUBRIC.map(([k]) => `"${k}":0`).join(",")}},"2":{...}},"preferred":"1|2|tie","rationale":"two or three sentences"}]}`;
  const prompt = `Read packet.md in the current directory with the view tool (it may need several reads). Follow its instructions for every section (${pairs.map((p) => p.id).join(", ")}). Reply with only a JSON object of this shape and nothing else: ${shape}`;
  log(`judge (${flags["judge-model"]}) on ${pairs.length} pairs`);
  const r = await run("copilot", ["-s", "--model", flags["judge-model"], "--available-tools", "view", "--allow-all-tools", "--no-ask-user", "-p", prompt], {
    cwd: judgeRoot, env: { ...process.env, COPILOT_HOME: join(judgeRoot, "home", ".copilot"), HOME: join(judgeRoot, "home") }, timeout: 20 * 60_000,
  });
  writeFileSync(join(outDir, "judge-raw.txt"), r.stdout + (r.stderr ? `\n--- stderr ---\n${r.stderr}` : ""));
  const json = r.stdout.slice(r.stdout.indexOf("{"), r.stdout.lastIndexOf("}") + 1);
  let verdict;
  try { verdict = JSON.parse(json); } catch { log("judge reply was not JSON; see judge-raw.txt"); return { pairs: pairs.map(({ runs, ...p }) => p), verdict: null }; }
  // Unblind: map labels back to arms.
  const unblinded = verdict.pairs.map((v) => {
    const p = pairs.find((x) => x.id === v.id);
    if (!p) return { ...v, unknown: true };
    const scores = Object.fromEntries(Object.entries(v.scores).map(([label, s]) => [p.labels[label], s]));
    const preferred = v.preferred === "tie" ? "tie" : p.labels[v.preferred];
    return { id: v.id, task: p.task, model: p.model, rep: p.rep, labels: p.labels, scores, preferred, rationale: v.rationale };
  });
  return { judgeModel: flags["judge-model"], seed: Number(flags.seed), pairs: unblinded };
}

function table(rows) {
  const head = Object.keys(rows[0]);
  return [`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${head.map((h) => r[h]).join(" | ")} |`)].join("\n");
}

// Wilson score interval for a binomial proportion, 95% by default.
function wilson(k, n, z = 1.96) {
  if (!n) return [0, 1];
  const p = k / n;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const h = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  return [(c - h) / d, (c + h) / d];
}

const passed = (r) => Boolean(r.grade && r.grade.hidden.total > 0 && r.grade.hidden.pass === r.grade.hidden.total);
const pct = (x) => `${Math.round(x * 100)}%`;

function summary(results) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.task}|${r.model}|${r.arm}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rate = (rs) => {
    const k = rs.filter(passed).length;
    const [lo, hi] = wilson(k, rs.length);
    return `${k}/${rs.length} (${pct(k / rs.length)}, 95% CI ${pct(lo)} to ${pct(hi)})`;
  };
  const perTask = [...groups.values()].map((rs) => ({
    task: rs[0].task, model: rs[0].model, arm: rs[0].arm,
    "hidden all-pass": rate(rs),
    "mean hidden": (rs.reduce((n, r) => n + (r.grade ? r.grade.hidden.pass / Math.max(1, r.grade.hidden.total) : 0), 0) / rs.length).toFixed(2),
    errors: rs.filter((r) => !r.grade).length,
  }));
  const perArm = [...new Set(results.map((r) => `${r.model}|${r.arm}`))].map((key) => {
    const rs = results.filter((r) => `${r.model}|${r.arm}` === key);
    const premium = rs.reduce((n, r) => n + (r.grade?.transcript?.premiumRequests ?? 0), 0);
    return {
      model: rs[0].model, arm: rs[0].arm, runs: rs.length,
      "hidden all-pass": rate(rs),
      "premium requests": premium,
      "wall s (total)": Math.round(rs.reduce((n, r) => n + (r.wallMs ?? 0), 0) / 1000),
      "wall s (median)": Math.round([...rs.map((r) => r.wallMs ?? 0)].sort((a, b) => a - b)[Math.floor(rs.length / 2)] / 1000),
      "routing context": rs.filter((r) => r.grade?.transcript?.routingContext).length,
    };
  });
  return { perTask, perArm };
}

function report(results, verdict) {
  const rows = results.map((r) => {
    const g = r.grade;
    const t = g?.transcript;
    return {
      task: r.task, model: r.model, rep: r.rep, arm: r.arm,
      hidden: g ? `${g.hidden.pass}/${g.hidden.total}` : "error",
      "own suite": g ? `${g.ownSuite.pass}/${g.ownSuite.total}` : "",
      files: g?.diff.filesTouched ?? "",
      "src +/-": g ? `+${g.diff.srcAdded}/-${g.diff.srcRemoved}` : "",
      "test +": g?.diff.testAdded ?? "",
      comments: g?.diff.addedCommentLines ?? "",
      "ran tests": t ? (t.ranTests ? "yes" : "no") : "",
      skills: t?.skills.length ? t.skills.join(", ") : "none",
      subagents: t?.tasks.length ? t.tasks.map((x) => `${x.agent_type}@${x.model ?? "inherit"}`).join(", ") : "none",
      premium: t?.premiumRequests ?? "",
      "wall s": Math.round((r.wallMs ?? 0) / 1000),
    };
  });
  const judged = verdict?.pairs?.length ? table(verdict.pairs.map((p) => ({
    pair: p.id, task: p.task, "blind order": `1=${p.labels[1]} 2=${p.labels[2]}`, preferred: p.preferred,
    ...Object.fromEntries(RUBRIC.map(([k]) => [`${k} A/B`, `${p.scores.A?.[k] ?? "?"}/${p.scores.B?.[k] ?? "?"}`])),
  }))) : "No judge verdict.";
  const { perTask, perArm } = summary(results);
  return [
    `# Copilot A/B run ${stamp}`,
    "",
    `Arms: A = plain Copilot CLI, B = Copilot CLI with pstack installed. Models: ${[...new Set(results.map((r) => r.model))].join(", ")}. Reps: ${[...new Set(results.map((r) => r.rep))].sort().join(", ")}. Judge: ${verdict ? verdict.judgeModel : "none"}.`,
    "",
    "## Pass rate per arm",
    "",
    table(perArm),
    "",
    "## Pass rate per task",
    "",
    table(perTask),
    "",
    "## Deterministic results",
    "",
    table(rows),
    "",
    "## Blinded judge",
    "",
    judged,
    "",
  ].join("\n");
}

// Compact, committable view of one transcript: tool calls with short arguments,
// skills, subagent dispatches, hook context presence, and usage.
function extract(eventsPath) {
  const short = (v) => (typeof v === "string" && v.length > 300 ? `${v.slice(0, 300)}...` : v);
  const out = [];
  for (const line of readFileSync(eventsPath, "utf8").split("\n").filter(Boolean)) {
    const e = JSON.parse(line);
    const d = e.data ?? {};
    if (e.type === "tool.execution_start") out.push({ t: e.type, tool: d.toolName, args: Object.fromEntries(Object.entries(d.arguments ?? {}).map(([k, v]) => [k, short(v)])) });
    else if (e.type === "tool.execution_complete") out.push({ t: e.type, ok: d.success, error: short(d.error?.message) });
    else if (e.type === "hook.end") out.push({ t: e.type, hook: d.hookType ?? d.hookName, context: typeof d.output?.additionalContext === "string" ? d.output.additionalContext.length : null });
    else if (/^(skill\.invoked|session\.(start|shutdown|resume)|permission\.(requested|completed)|subagent\.)/.test(e.type)) out.push({ t: e.type, data: e.type === "session.shutdown" ? { totalPremiumRequests: d.totalPremiumRequests, totalApiDurationMs: d.totalApiDurationMs } : Object.fromEntries(Object.entries(d).map(([k, v]) => [k, short(typeof v === "object" ? JSON.stringify(v) : v)])) });
  }
  return out.map((o) => JSON.stringify(o)).join("\n") + "\n";
}

// Keeps each candidate's workdir, reply, and session state under a gitignored
// archive, and rewrites result paths so results.json resolves against the repo.
function archive(r) {
  if (!r.root) return r;
  const name = `${r.task}.${r.model}.r${r.rep}.${r.arm}`;
  const dest = join(archiveDir, name);
  mkdirSync(dest, { recursive: true });
  if (existsSync(r.work)) cpSync(r.work, join(dest, "work"), { recursive: true, filter: (src) => !src.includes("/node_modules") });
  if (existsSync(join(r.root, "reply.txt"))) cpSync(join(r.root, "reply.txt"), join(dest, "reply.txt"));
  if (existsSync(join(r.home, "session-state"))) cpSync(join(r.home, "session-state"), join(dest, "session-state"), { recursive: true });
  if (r.events) writeFileSync(join(outDir, `${name}.events.jsonl`), extract(r.events));
  return {
    ...r, root: undefined, home: undefined,
    archived: relative(repo, dest),
    work: relative(repo, join(dest, "work")),
    events: r.events ? relative(repo, join(dest, "session-state", relative(join(r.home, "session-state"), r.events))) : null,
    eventsExtract: r.events ? relative(repo, join(outDir, `${name}.events.jsonl`)) : null,
  };
}

// Re-grades archived runs from earlier results directories against the current
// hidden checks, and merges them into one results.json and report.
async function regrade() {
  const loaded = flags.regrade.split(",").filter(Boolean).flatMap((dir) => JSON.parse(readFileSync(join(dir, "results.json"), "utf8")).results);
  const graded = await pool(loaded, Number(flags.parallel), async (r) => {
    if (!r.archived) return r;
    const root = realpathSync(mkdtempSync(join(base, "ws-")));
    const job = { ...r, root, work: join(repo, r.work), events: r.events && join(repo, r.events), env: { ...process.env, ...gitEnv } };
    const g = await grade(job);
    rmSync(root, { recursive: true, force: true });
    if (job.events) writeFileSync(join(outDir, `${r.task}.${r.model}.r${r.rep}.${r.arm}.events.jsonl`), extract(job.events));
    writeFileSync(join(outDir, `${r.task}.${r.model}.r${r.rep}.${r.arm}.diff`), g.diff.patch);
    return { ...r, eventsExtract: relative(repo, join(outDir, `${r.task}.${r.model}.r${r.rep}.${r.arm}.events.jsonl`)), grade: g };
  });
  const slim = graded.map(({ grade: g, ...r }) => ({ ...r, grade: g && { ...g, diff: { ...g.diff, patch: undefined } } }));
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ stamp, regradedFrom: flags.regrade.split(","), results: slim }, null, 2));
  writeFileSync(join(outDir, "report.md"), report(graded, null));
  rmSync(base, { recursive: true, force: true });
  log(`regraded ${graded.length} runs into ${outDir}`);
}

async function main() {
  if (flags.regrade) return regrade();
  for (const task of tasks) if (!existsSync(join(fixturesDir, task, "prompt.txt"))) throw new Error(`unknown task ${task}`);
  const pluginDir = arms.includes("B") ? exportPlugin() : null;
  const jobs = [];
  for (const task of tasks) for (const model of models) for (const rep of repList) for (const arm of arms) {
    jobs.push({ id: `${task}/${model}/r${rep}/${arm}`, task, model, rep, arm });
  }
  log(`${jobs.length} runs under ${base}; results in ${relative(process.cwd(), outDir) || outDir}`);
  const prepared = await pool(jobs, Number(flags.parallel), (j) => prepare(j, pluginDir));
  const ran = await pool(prepared, Number(flags.parallel), (j) => (j.error ? j : candidate(j)));
  const graded = await pool(ran, Number(flags.parallel), async (j) => (j.error ? j : { ...j, grade: await grade(j) }));
  const verdict = flags["no-judge"] ? null : await judge(graded);
  const slim = graded.map(archive).map(({ env, grade: g, ...r }) => ({ ...r, grade: g && { ...g, diff: { ...g.diff, patch: undefined } } }));
  writeFileSync(join(outDir, "results.json"), JSON.stringify({ stamp, base, flags, results: slim }, null, 2));
  for (const r of graded) if (r.grade) writeFileSync(join(outDir, `${r.task}.${r.model}.r${r.rep}.${r.arm}.diff`), r.grade.diff.patch);
  if (verdict) writeFileSync(join(outDir, "judge.json"), JSON.stringify(verdict, null, 2));
  writeFileSync(join(outDir, "report.md"), report(graded, verdict));
  log(`wrote ${outDir}; workdirs and transcripts archived under ${archiveDir}; the temp root ${base} can be deleted`);
}

main().catch((error) => { console.error(error); process.exit(1); });
