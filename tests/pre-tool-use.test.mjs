// The shipped PreToolUse command, run for real: on GitHub Copilot it approves
// `view` of the plugin's own files and stays silent for everything else.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../plugins/pstack/", import.meta.url));
const preToolUse = JSON.parse(readFileSync(join(pluginRoot, "hooks/hooks.json"), "utf8")).hooks.PreToolUse;
const command = preToolUse[0].hooks[0].command;
const allow = '{"permissionDecision":"allow"}\n';
const playbook = join(pluginRoot, "skills/poteto-mode/playbooks/bug-fix.md");

// Copilot sends Claude-format input to PascalCase hooks (observed on Copilot
// CLI 1.0.89): tool_name is the Claude name, so `view` arrives as `Read`.
const claudeInput = (tool, path) =>
  JSON.stringify({ hook_event_name: "PreToolUse", cwd: "/work", tool_name: tool, tool_input: { path } });

function run(input, env = { COPILOT_PLUGIN_ROOT: pluginRoot }) {
  const r = spawnSync("sh", ["-c", command], {
    input,
    env: { PATH: process.env.PATH, CLAUDE_PLUGIN_ROOT: pluginRoot, ...env },
    encoding: "utf8",
  });
  return { status: r.status, out: r.stdout, err: r.stderr };
}

describe("PreToolUse hook", () => {
  // Claude Code tool names are capitalized and Codex sends Bash, so the
  // literal matcher `view` fires only on Copilot.
  test("matches only Copilot's view tool", () => {
    expect(preToolUse).toHaveLength(1);
    expect(preToolUse[0].matcher).toBe("view");
  });

  test("approves view inside the plugin root", () => {
    expect(run(claudeInput("Read", playbook))).toEqual({ status: 0, out: allow, err: "" });
    expect(run(JSON.stringify({ toolName: "view", toolArgs: { path: playbook } }))).toEqual({ status: 0, out: allow, err: "" });
  });

  test("approves through the real path when the root is a symlink", () => {
    const dir = mkdtempSync(join(tmpdir(), "pstack-ptu-"));
    try {
      const link = join(dir, "pstack");
      symlinkSync(pluginRoot, link);
      const env = { COPILOT_PLUGIN_ROOT: link };
      expect(run(claudeInput("Read", join(link, "skills/how/SKILL.md")), env).out).toBe(allow);
      expect(run(claudeInput("Read", join(realpathSync(pluginRoot), "skills/how/SKILL.md")), env).out).toBe(allow);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  const silent = {
    "a path that climbs out with ..": claudeInput("Read", join(pluginRoot, "../../../etc/passwd")),
    "a path with a . segment": claudeInput("Read", `${pluginRoot}./skills/how/SKILL.md`),
    "a path outside the plugin": claudeInput("Read", "/etc/passwd"),
    "a sibling directory sharing the prefix": claudeInput("Read", `${pluginRoot.replace(/\/$/, "")}-evil/x.md`),
    "the plugin root itself": claudeInput("Read", pluginRoot.replace(/\/$/, "")),
    "an empty path": claudeInput("Read", ""),
    "a quoted path": claudeInput("Read", `${pluginRoot}x"y.md`),
    "another tool": claudeInput("Bash", playbook),
    "an edit inside the plugin": claudeInput("Edit", playbook),
    "input that is not JSON": "not json",
    "empty input": "",
  };
  for (const [name, input] of Object.entries(silent)) {
    test(`stays silent and exits 0 for ${name}`, () => {
      expect(run(input)).toEqual({ status: 0, out: "", err: "" });
    });
  }

  test("stays silent outside Copilot", () => {
    expect(run(claudeInput("Read", playbook), {})).toEqual({ status: 0, out: "", err: "" });
    expect(run(claudeInput("Read", playbook), { PLUGIN_ROOT: pluginRoot })).toEqual({ status: 0, out: "", err: "" });
  });
});
