import { cyan, padVisible, visibleLength } from "./colors.ts";
import { defaultCommands } from "./catalog.ts";
import type { Command, Flag, HelpOptions } from "./model.ts";

function maxLength(values: string[], fallback: number): number {
  return values.length ? Math.max(...values.map((value) => visibleLength(value))) : fallback;
}

function flagLabel(flag: Flag): string {
  return cyan(flag.name);
}

export function formatHelp(commands: Command[] = defaultCommands, options: HelpOptions = {}): string {
  const program = options.program ?? "notes";
  const lines = [`Usage: ${program} <command> [options]`, "", "Commands:"];
  const commandWidth = maxLength(commands.map((command) => command.name), 7);
  for (const command of commands) {
    lines.push(`  ${padVisible(command.name, commandWidth)}  ${command.summary}`);
  }

  const flags = commands.flatMap((command) => command.flags ?? []);
  if (flags.length) {
    lines.push("", "Flags:");
    const flagWidth = maxLength(flags.map((flag) => flag.name), 6);
    for (const flag of flags) {
      lines.push(`  ${padVisible(flagLabel(flag), flagWidth)}  ${flag.description}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
