import type { Command } from "./model.ts";

export const defaultCommands: Command[] = [
  {
    name: "publish",
    summary: "Publish the current draft",
    flags: [
      { name: "--dry-run", description: "Show what would change without saving" },
      { name: "--tag", description: "Limit the command to one tag" },
    ],
  },
  { name: "list", summary: "List recent drafts" },
];
