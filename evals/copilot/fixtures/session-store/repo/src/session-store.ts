import { sessionBytes } from "./size.ts";
import type { SessionRecord, StoredSession } from "./types.ts";

type Entry = {
  record: SessionRecord;
  bytes: number;
};

export class SessionStore {
  private readonly entries = new Map<string, Entry>();
  private currentBytes = 0;
  readonly maxBytes: number;

  constructor(maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) {
      throw new RangeError("maxBytes must be a positive integer");
    }
    this.maxBytes = maxBytes;
  }

  get sizeBytes(): number {
    return this.currentBytes;
  }

  get count(): number {
    return this.entries.size;
  }

  get(id: string): SessionRecord | undefined {
    return this.entries.get(id)?.record;
  }

  set(id: string, record: SessionRecord): void {
    const bytes = sessionBytes(record);
    if (bytes > this.maxBytes) throw new RangeError("session is larger than the store budget");
    this.entries.set(id, { record, bytes });
    this.currentBytes += bytes;
    this.trimToBudget();
  }

  delete(id: string): boolean {
    const entry = this.entries.get(id);
    if (!entry) return false;
    this.entries.delete(id);
    this.currentBytes -= entry.bytes;
    return true;
  }

  clear(): void {
    this.entries.clear();
    this.currentBytes = 0;
  }

  keys(): string[] {
    return [...this.entries.keys()];
  }

  snapshot(): StoredSession[] {
    return [...this.entries.entries()].map(([id, entry]) => ({ id, record: entry.record, bytes: entry.bytes }));
  }

  private trimToBudget(): void {
    while (this.currentBytes > this.maxBytes) {
      const oldest = this.entries.entries().next().value;
      if (!oldest) return;
      const [id, entry] = oldest;
      this.entries.delete(id);
      this.currentBytes -= entry.bytes;
    }
  }
}
