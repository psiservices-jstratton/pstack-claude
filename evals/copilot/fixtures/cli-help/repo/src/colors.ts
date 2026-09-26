const ANSI_PATTERN = /\u001b\[[0-9;]*m/g;

export function cyan(text: string): string {
  return `\u001b[36m${text}\u001b[0m`;
}

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

export function visibleLength(text: string): number {
  return stripAnsi(text).length;
}

export function padVisible(text: string, width: number): string {
  return text + " ".repeat(Math.max(0, width - visibleLength(text)));
}
