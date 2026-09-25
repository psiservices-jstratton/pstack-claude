// GitHub Copilot build contracts: the mapping names every Claude-specific term
// the skills use, each Codex pointer has its Copilot twin, the stamps are
// idempotent, and the Copilot model block ships no slugs.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import {
  applyRegions,
  CODEX_POINTER,
  COPILOT_POINTER,
  COPILOT_POINTER_SKILLS,
  COPILOT_SETUP_RULE,
  COPILOT_SHEET_RULE,
  COPILOT_SHEET_SKILLS,
  copilotSessionContext,
  deriveSkill,
  loadModels,
  pointerRegions,
  SAVED_CHOICES_MARKER,
  validateCopilotModels,
} from "../tools/generate.mjs";
import { markdownFiles } from "../tools/validate-skills.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const skillsDir = join(repoRoot, "plugins/pstack/skills");
const mappingPath = join(skillsDir, "poteto-mode/references/copilot-tools.md");
const mapping = readFileSync(mappingPath, "utf8");
const models = loadModels();

// Claude-specific terms a skill may name, and the text copilot-tools.md must
// carry to map each one. A term the skills stop using drops out of the check.
const TERMS = [
  ["AskUserQuestion", "`AskUserQuestion`"],
  ["subagent_type", "`subagent_type"],
  ["run_in_background", "`run_in_background: true`"],
  ["TodoWrite", "`TodoWrite`"],
  ["TaskCreate", "`TaskCreate`"],
  ["TaskUpdate", "`TaskUpdate`"],
  ["readonly", "`readonly: true`"],
  ["the `Skill` tool", "the `Skill` tool"],
  ["the `Agent` tool", "the `Agent`/`Task` tool"],
  ["`Read`", "`Read`"],
  ["`loop`", "`loop`"],
  ["/loop", "`/loop`"],
  ["plugin-dev", "`plugin-dev:skill-development`"],
  [".claude/projects", "`~/.claude/projects/"],
  [".claude/skills", "`.claude/skills/`"],
  ["~/.claude/orchestrate", "`~/.claude/orchestrate/`"],
  ["CLAUDE.md", "`CLAUDE.md`"],
  ["mcp__", "`mcp__`"],
  ["pstack:poteto-agent", "`pstack:poteto-agent`"],
  ["pstack:comment-sicko", "`pstack:comment-sicko`"],
  ["general-purpose", "`general-purpose`"],
];

const skillText = markdownFiles(skillsDir)
  .filter((f) => !f.endsWith("/codex-tools.md") && !f.endsWith("/copilot-tools.md"))
  .map((f) => [relative(skillsDir, f), readFileSync(f, "utf8")]);

describe("copilot-tools.md coverage", () => {
  for (const [term, row] of TERMS) {
    const users = skillText.filter(([, text]) => text.includes(term)).map(([rel]) => rel);
    test(`${term} (${users.length} files) has a Copilot mapping`, () => {
      if (users.length) expect(mapping).toContain(row);
    });
  }

  test("every Claude model tier resolves without shipping a Copilot slug", () => {
    const names = mapping.slice(mapping.indexOf("## Model names"), mapping.indexOf("## Session routing hook"));
    expect(names).toContain("ships no default model IDs");
    expect(names).toContain("`${COPILOT_HOME:-~/.copilot}/pstack-models.md`");
    expect(names).toContain("run `setup-pstack` first");
    expect(names).toContain("Do not ask again");
    expect(names).toContain("saved pstack model choices");
    expect(names).toContain("do not `view` the sheet");
    expect(names).toContain("use the values it just wrote");
    expect(names).toContain("`model` parameter");
    expect(names).toContain("distinct vendors");
    for (const role of models.roles.filter((r) => r.tier === "strongest")) expect(names).toContain(`\`${role.role}\``);
    for (const skill of new Set(models.roles.map((r) => r.skill))) expect(names).toContain(`\`${skill}\``);
    for (const slug of models.codex.panel) expect(mapping).not.toContain(slug);
  });

  test("every skill with a per-skill note exists and every pointed skill has one or needs none", () => {
    const table = mapping.slice(mapping.indexOf("## Per-skill notes"), mapping.indexOf("## Vendored scripts"));
    const noted = [...table.matchAll(/^\| `([a-z0-9-]+)` \|/gm)].map((m) => m[1]);
    const skills = new Set(skillText.filter(([rel]) => rel.endsWith("/SKILL.md")).map(([rel]) => rel.split("/")[0]));
    for (const name of noted) expect(skills.has(name)).toBe(true);
    for (const name of ["interrogate", "setup-pstack", "no-comments", "reflect", "recall", "babysit"]) {
      expect(noted).toContain(name);
    }
  });

  test("names both surfaces and the app-only primitives with CLI fallbacks", () => {
    for (const s of ["create_session", "save_session_automation", "`orchestrate`", "`pr-stack`", "`git worktree add`", "`/fleet`"]) {
      expect(mapping).toContain(s);
    }
  });
});

describe("Copilot pointers", () => {
  const withCodex = markdownFiles(skillsDir).filter((f) => readFileSync(f, "utf8").includes(CODEX_POINTER));

  test("every Codex pointer is followed by its Copilot pointer, and only there", () => {
    expect(withCodex.length).toBeGreaterThan(0);
    for (const file of markdownFiles(skillsDir)) {
      const lines = readFileSync(file, "utf8").split("\n");
      const codex = lines.flatMap((l, i) => (l === CODEX_POINTER ? [i] : []));
      const copilot = lines.flatMap((l, i) => (l.startsWith(COPILOT_POINTER) ? [i] : []));
      expect({ file, copilot }).toEqual({ file, copilot: codex.map((i) => i + 2) });
      for (const i of codex) expect(lines[i + 1]).toBe("");
    }
  });

  test("skills that dispatch on role models carry the no-sheet rule in their pointer, others do not", () => {
    expect(COPILOT_SHEET_SKILLS.every((s) => COPILOT_POINTER_SKILLS.includes(s))).toBe(true);
    expect(COPILOT_SHEET_RULE).toContain("load the `setup-pstack` skill with the `skill` tool");
    for (const skill of COPILOT_POINTER_SKILLS) {
      const text = readFileSync(join(skillsDir, skill, "SKILL.md"), "utf8");
      const rule = COPILOT_SHEET_SKILLS.includes(skill) ? COPILOT_SHEET_RULE : skill === "setup-pstack" ? COPILOT_SETUP_RULE : "";
      const want = rule ? `${COPILOT_POINTER} ${rule}` : COPILOT_POINTER;
      expect({ skill, line: text.split("\n").find((l) => l.startsWith(COPILOT_POINTER)) }).toEqual({ skill, line: want });
    }
  });

  test("the pointer list names exactly the skills that carry a Codex pointer", () => {
    const skills = withCodex.map((f) => relative(skillsDir, f).split("/")[0]).sort();
    expect(skills).toEqual([...COPILOT_POINTER_SKILLS].sort());
  });

  test("poteto-mode's Platform Adaptation names the Copilot mapping", () => {
    const text = readFileSync(join(skillsDir, "poteto-mode/SKILL.md"), "utf8");
    expect(text).toContain("On GitHub Copilot, read [`references/copilot-tools.md`](references/copilot-tools.md)");
  });

  test("stamping is idempotent and removes nothing but its own lines", () => {
    for (const region of pointerRegions()) {
      const text = readFileSync(join(repoRoot, region.file), "utf8");
      expect(applyRegions(region.file, text, models)).toBe(text);
      const lines = text.split("\n");
      const [start, end] = region.locate(lines);
      const bare = [...lines.slice(0, start), ...lines.slice(end)].join("\n");
      expect(applyRegions(region.file, bare, models)).toBe(text);
      expect(applyRegions(region.file, applyRegions(region.file, bare, models), models)).toBe(text);
    }
  });

  test("an upstream copy without the Codex pointer derives without a Copilot pointer", () => {
    const file = "plugins/pstack/skills/arena/SKILL.md";
    const upstream = "---\nname: arena\ndescription: x\n---\n\n# Arena\n\nFan out.\n\n## Models\n";
    expect(deriveSkill(file, upstream, models)).not.toContain("On GitHub Copilot");
  });
});

describe("Copilot model block", () => {
  test("ships no slugs and passes validation", () => {
    expect(models.copilot).toEqual({ default: null, strongest: null, panel: [] });
    expect(() => validateCopilotModels(models)).not.toThrow();
  });

  test("accepts configured IDs and rejects malformed ones", () => {
    const withBlock = (copilot) => ({ ...models, copilot });
    expect(() => validateCopilotModels(withBlock({ default: "a", strongest: "b", panel: ["a", "c"] }))).not.toThrow();
    expect(() => validateCopilotModels(withBlock({ default: null, panel: [] }))).toThrow("tier keys");
    expect(() => validateCopilotModels(withBlock({ default: null, strongest: null, panel: ["a", "a"] }))).toThrow(
      "distinct",
    );
    expect(() => validateCopilotModels(withBlock({ default: 3, strongest: null, panel: [] }))).toThrow("model ID or null");
    expect(() => validateCopilotModels({ ...models, copilot: undefined })).toThrow("no copilot block");
  });
});

describe("Copilot session context", () => {
  const mandate = readFileSync(join(repoRoot, "plugins/pstack/hooks/session-start-context.md"), "utf8");
  const addendum = readFileSync(join(repoRoot, "plugins/pstack/hooks/session-start-copilot.md"), "utf8");

  test("the committed JSON is the stamp of the mandate and the addendum", () => {
    const committed = readFileSync(join(repoRoot, "plugins/pstack/hooks/session-start-context.json"), "utf8");
    const sheet = readFileSync(join(repoRoot, "plugins/pstack/hooks/session-start-copilot-sheet.md"), "utf8");
    expect(copilotSessionContext(mandate, `${addendum.trim()}\n\n${sheet}`)).toBe(committed);
    expect(committed.split(SAVED_CHOICES_MARKER)).toHaveLength(2);
    expect(sheet).toContain("saved pstack model choices");
  });

  test("the no-sheet JSON adds only the setup-first paragraph", () => {
    const noSheet = readFileSync(join(repoRoot, "plugins/pstack/hooks/session-start-copilot-nosheet.md"), "utf8");
    const committed = readFileSync(join(repoRoot, "plugins/pstack/hooks/session-start-context-nosheet.json"), "utf8");
    expect(copilotSessionContext(mandate, `${addendum.trim()}\n\n${noSheet}`)).toBe(committed);
    expect(noSheet).toContain("load `setup-pstack` with the `skill` tool");
    expect(committed).not.toContain(SAVED_CHOICES_MARKER);
  });

  test("the addendum lands inside the one closing tag", () => {
    const { additionalContext } = JSON.parse(copilotSessionContext("<T>\nbody\n</EXTREMELY_IMPORTANT>\n", "extra\n"));
    expect(additionalContext).toBe("<T>\nbody\n\nextra\n</EXTREMELY_IMPORTANT>\n");
    expect(() => copilotSessionContext("no tag", "x")).toThrow("exactly one");
    expect(() => copilotSessionContext("</EXTREMELY_IMPORTANT></EXTREMELY_IMPORTANT>", "x")).toThrow("exactly one");
  });

  test("the addendum resolves names through the mapping and the Copilot sheet", () => {
    expect(addendum).toContain("`references/copilot-tools.md`");
    expect(addendum).toContain("`${COPILOT_HOME:-~/.copilot}/pstack-models.md`");
    expect(addendum).toContain("`setup-pstack`");
    expect(addendum).toContain("saved pstack model choices");
    expect(addendum).toContain("Do not `view` the sheet");
    expect(addendum).toContain("use the values it just wrote");
  });
});

// Copilot's ask_user is single-select with one question per call, and pstack
// ships no Copilot models, so setup asks tier by tier from choice lists.
describe("Copilot setup questions", () => {
  const setupDir = join(skillsDir, "setup-pstack");
  const skill = readFileSync(join(setupDir, "SKILL.md"), "utf8");
  const questions = readFileSync(join(setupDir, "copilot.md"), "utf8");
  const sheetShape = skill.slice(skill.indexOf("### 6. Write the override sheet"), skill.indexOf("### 7."));
  const roles = [...sheetShape.matchAll(/^([a-z][a-z ,-]*): /gm)].map((m) => m[1]).filter((r) => r !== "session hook");
  const sequence = questions.slice(questions.indexOf("## Question sequence"));

  test("the setup pointer sends Copilot to the question file", () => {
    expect(COPILOT_SETUP_RULE).toContain("[the Copilot setup questions](copilot.md)");
    expect(COPILOT_SETUP_RULE).toContain("`choices` list");
  });

  test("every sheet role is written by exactly one tier or panel question", () => {
    const written = [...sequence.matchAll(/\bwrites ([^.]*)\./g)].flatMap((m) => [...m[1].matchAll(/`([^`]+)`/g)].map((r) => r[1]));
    expect(roles.length).toBe(17);
    expect([...written].sort()).toEqual([...roles].sort());
  });

  test("asks by tier, panel slot, override, and hook, in order", () => {
    const steps = [
      "**Default model.**",
      "**Strongest model.**",
      "**Panel model 1 of 3**",
      "**panel model 2 of 3**",
      "**panel model 3 of 3**",
      '"Add a 4th panel model?" with `Done` as the first choice',
      "**Vendor check.**",
      '"Override any individual role?" with `No, write the sheet (Recommended)` first',
      "**Session hook.**",
    ];
    const at = steps.map((step) => sequence.indexOf(step));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(sequence).toContain("list the vendors not yet in the panel first");
    expect(sequence).toContain("`Pick the panel again` and `Keep it anyway`");
  });

  test("every model question is a short choices list grouped by vendor", () => {
    expect(questions).toContain("Ask every model question through `ask_user` with a `choices` list");
    expect(questions).toContain("Never ask for models as one open question");
    expect(questions).toContain("never bundle two questions into one call");
    expect(questions).toContain("**Vendor.**");
    expect(questions).toContain("so no choices list holds the whole enum");
    expect(questions).toContain("`inherit-parent (run on the session's model)`");
  });

  test("recommends no model and marks saved values as current", () => {
    expect(questions).toContain("Do not propose, pre-select, or label any model `(Recommended)`");
    expect(questions.match(/\(Recommended\)/g)).toHaveLength(2);
    expect(questions).toContain("labeled `(current)`");
    expect(skill).not.toMatch(/propose a primary model|accept as-is or change specific roles.*Copilot/);
  });

  test("writes nothing it could not ask about", () => {
    expect(questions).toContain("do not choose for the user and do not write the sheet");
    expect(questions).toContain("Do not test for the sheet or its directory with `bash`");
    expect(questions).toContain("Write the sheet in one tool call");
  });

  test("the mapping row says ask_user is single-select", () => {
    const row = mapping.split("\n").find((l) => l.includes("(`AskUserQuestion`)"));
    expect(row).toContain("`ask_user` with a `choices` list");
    expect(row).toContain("single-select only");
    expect(row).toContain("Emulate multi-select with sequential questions");
  });
});
