import { dedupeContacts } from "./dedupe.ts";
import { parseContacts } from "./parse.ts";

export function prepareImport(csv: string) {
  const parsed = parseContacts(csv);
  const contacts = dedupeContacts(parsed);
  return { contacts, skipped: parsed.length - contacts.length };
}
