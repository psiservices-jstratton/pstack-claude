// The shipped SessionStart command, run for real with each runtime's environment:
// the mandate is injected unless that runtime's model sheet turns it off.
import { describe, expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const pluginRoot = fileURLToPath(new URL("../plugins/pstack/", import.meta.url));
const sessionStart = JSON.parse(readFileSync(join(pluginRoot, "hooks/hooks.json"), "utf8")).hooks.SessionStart[0];
const command = sessionStart.hooks[0].command;
const mandate = readFileSync(join(pluginRoot, "hooks/session-start-context.md"), "utf8");
const copilotContext = readFileSync(join(pluginRoot, "hooks/session-start-context.json"), "utf8");
const copilotNoSheet = readFileSync(join(pluginRoot, "hooks/session-start-context-nosheet.json"), "utf8");
const codexManifest = JSON.parse(readFileSync(join(pluginRoot, ".codex-plugin/plugin.json"), "utf8"));

// Codex sets PLUGIN_ROOT; CODEX_HOME is only present when the user has
// relocated their Codex directory. GitHub Copilot sets every plugin-root
// variable plus COPILOT_PLUGIN_ROOT (observed on Copilot CLI 1.0.87), and
// COPILOT_HOME only when the user relocated ~/.copilot.
const copilotEnv = () => ({ PLUGIN_ROOT: pluginRoot, COPILOT_PLUGIN_ROOT: pluginRoot, COPILOT_CLI: "1" });
const runtimes = {
  claude: { sheetDir: ".claude", env: () => ({}), out: mandate, noSheet: mandate },
  codex: { sheetDir: ".codex", env: () => ({ PLUGIN_ROOT: pluginRoot }), out: mandate, noSheet: mandate },
  "codex with CODEX_HOME": {
    sheetDir: "codex-home",
    env: (sheetRoot) => ({ PLUGIN_ROOT: pluginRoot, CODEX_HOME: sheetRoot }),
    out: mandate,
    noSheet: mandate,
  },
  // With no sheet yet, Copilot also gets the setup-first line.
  copilot: { sheetDir: ".copilot", env: copilotEnv, out: copilotContext, noSheet: copilotNoSheet },
  "copilot with COPILOT_HOME": {
    sheetDir: "copilot-home",
    env: (sheetRoot) => ({ ...copilotEnv(), COPILOT_HOME: sheetRoot }),
    out: copilotContext,
    noSheet: copilotNoSheet,
  },
};

function runHook(runtime, sheet) {
  const home = mkdtempSync(join(tmpdir(), "pstack-hook-"));
  const { sheetDir, env } = runtimes[runtime];
  const sheetRoot = join(home, sheetDir);
  if (sheet !== null) {
    mkdirSync(sheetRoot);
    writeFileSync(join(sheetRoot, "pstack-models.md"), sheet);
  }
  try {
    const r = spawnSync("sh", ["-c", command], {
      env: { PATH: process.env.PATH, HOME: home, CLAUDE_PLUGIN_ROOT: pluginRoot, ...env(sheetRoot) },
      encoding: "utf8",
    });
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

describe("SessionStart hook", () => {
  // The manifest names the shared hooks file instead of relying on Codex's
  // default discovery; `resume` keeps the mandate present after a restart.
  test("declares the hook in the Codex manifest", () => {
    expect(codexManifest.hooks).toBe("./hooks/hooks.json");
    expect(sessionStart.matcher).toBe("startup|resume|clear|compact");
  });

  for (const runtime of Object.keys(runtimes)) {
    describe(runtime, () => {
      test("injects the mandate when no sheet exists", () => {
        expect(runHook(runtime, null)).toEqual({ status: 0, out: runtimes[runtime].noSheet, err: "" });
      });

      test("injects the mandate when the sheet has no session hook line", () => {
        expect(runHook(runtime, "bug-fix: configured-model\n")).toEqual({ status: 0, out: runtimes[runtime].out, err: "" });
      });

      test("injects the mandate when the sheet says on", () => {
        expect(runHook(runtime, "bug-fix: configured-model\nsession hook: on\n")).toEqual({
          status: 0,
          out: runtimes[runtime].out,
          err: "",
        });
      });

      test("injects nothing when the sheet says off", () => {
        expect(runHook(runtime, "bug-fix: configured-model\nsession hook: off\n")).toEqual({
          status: 0,
          out: "",
          err: "",
        });
      });
    });
  }

  // Copilot parses the hook's stdout with one JSON.parse and reads
  // additionalContext; plain text is dropped.
  test("Copilot output is one JSON object carrying the mandate and the Copilot addendum", () => {
    for (const sheet of [null, "session hook: on\n"]) {
      const { out } = runHook("copilot", sheet);
      const parsed = JSON.parse(out);
      expect(Object.keys(parsed)).toEqual(["additionalContext"]);
      const close = "</EXTREMELY_IMPORTANT>";
      const body = mandate.slice(0, mandate.indexOf(close));
      expect(parsed.additionalContext.startsWith(body)).toBe(true);
      expect(parsed.additionalContext).toContain("On GitHub Copilot, load pstack skills by their bare names");
      expect(parsed.additionalContext.trimEnd().endsWith(close)).toBe(true);
      const setupFirst = "This Copilot home has no pstack model sheet yet";
      if (sheet === null) expect(parsed.additionalContext).toContain(setupFirst);
      else expect(parsed.additionalContext).not.toContain(setupFirst);
    }
  });

  test("each runtime reads only its own sheet", () => {
    const home = mkdtempSync(join(tmpdir(), "pstack-hook-"));
    try {
      for (const dir of [".claude", ".codex"]) {
        mkdirSync(join(home, dir));
        writeFileSync(join(home, dir, "pstack-models.md"), "session hook: off\n");
      }
      const run = (env) =>
        spawnSync("sh", ["-c", command], {
          env: { PATH: process.env.PATH, HOME: home, CLAUDE_PLUGIN_ROOT: pluginRoot, ...env },
          encoding: "utf8",
        }).stdout;
      expect(run(copilotEnv())).toBe(copilotNoSheet);
      rmSync(join(home, ".claude"), { recursive: true });
      rmSync(join(home, ".codex"), { recursive: true });
      mkdirSync(join(home, ".copilot"));
      writeFileSync(join(home, ".copilot", "pstack-models.md"), "session hook: off\n");
      expect(run({})).toBe(mandate);
      expect(run({ PLUGIN_ROOT: pluginRoot })).toBe(mandate);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
