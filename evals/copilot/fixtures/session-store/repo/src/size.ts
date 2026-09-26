import type { SessionRecord } from "./types.ts";

const encoder = new TextEncoder();

export function sessionBytes(record: SessionRecord): number {
  return encoder.encode(JSON.stringify(record)).length;
}
