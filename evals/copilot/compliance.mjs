#!/usr/bin/env node
// Routing compliance for arm B runs: whether the sessionStart context arrived,
// poteto-mode loaded, a playbook was read, pstack dispatches used sheet models,
// and whether a preToolUse hook denied a call. Reads the full archived
// events.jsonl when present, otherwise the committed extract.
// Usage: compliance.mjs <results dir> [panel models, default claude-sonnet-5,grok-4.7]
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repo = join(dirname(fileURLToPath(import.meta.url)), "../..");
const [dir, panelArg = "claude-sonnet-5,grok-4.7"] = process.argv.slice(2);
const panel = panelArg.split(",").filter(Boolean);
const { results } = JSON.parse(readFileSync(join(dir, "results.json"), "utf8"));
const lines = (path) => readFileSync(path, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

function load(r) {
  const full = r.events && join(repo, r.events);
  if (full && existsSync(full)) {
    const events = lines(full);
    return {
      source: "archive",
      starts: events.filter((e) => e.type === "tool.execution_start").map((e) => ({ tool: e.data.toolName, args: e.data.arguments ?? {} })),
      hooks: events.filter((e) => e.type === "hook.end").map((e) => ({ hook: e.data?.hookType, context: String(e.data?.output?.additionalContext ?? "").includes("You have pstack."), decision: e.data?.output?.permissionDecision ?? null })),
    };
  }
  const events = lines(join(repo, r.eventsExtract));
  return {
    source: "extract",
    starts: events.filter((e) => e.t === "tool.execution_start").map((e) => ({ tool: e.tool, args: e.args ?? {} })),
    hooks: events.filter((e) => e.t === "hook.end").map((e) => ({ hook: e.hook, context: e.context > 0, decision: "decision" in e ? e.decision : undefined })),
  };
}

const rows = results.filter((r) => r.arm === "B").map((r) => {
  const { source, starts, hooks } = load(r);
  const sheet = new Set([r.model, ...panel]);
  const tasks = starts.filter((s) => s.tool === "task").map((s) => s.args);
  const skills = starts.filter((s) => s.tool === "skill").map((s) => String(s.args.skill));
  const playbooks = starts.filter((s) => ["view", "bash"].includes(s.tool)).flatMap((s) => String(s.args.path ?? s.args.command ?? "").match(/playbooks\/[\w-]+\.md/g) ?? []);
  const decided = hooks.filter((h) => h.hook === "preToolUse");
  return {
    run: `${r.task} r${r.rep}`,
    model: r.model,
    context: hooks.some((h) => h.hook === "sessionStart" && h.context) ? "yes" : "no",
    "poteto-mode": skills.some((s) => /poteto-mode$/.test(s)) ? "yes" : "no",
    playbook: [...new Set(playbooks.map((p) => p.slice(10, -3)))].join(", ") || "none",
    dispatches: tasks.length,
    "on sheet": tasks.filter((t) => !t.model || sheet.has(t.model)).length,
    "dispatch models": [...new Set(tasks.map((t) => `${t.agent_type}@${t.model ?? "inherit"}`))].join(", ") || "none",
    denies: decided.some((h) => h.decision === undefined) ? "n/a" : decided.filter((h) => h.decision === "deny").length,
    source,
  };
});

const head = Object.keys(rows[0] ?? {});
console.log([`| ${head.join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((r) => `| ${head.map((h) => r[h]).join(" | ")} |`)].join("\n"));
