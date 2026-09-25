import type { Contact } from "./dedupe.ts";

export function parseContacts(csv: string): Contact[] {
  const [header, ...lines] = csv.trim().split(/\r?\n/);
  const cols = header.split(",").map((c) => c.trim().toLowerCase());
  return lines.filter((line) => line.trim() !== "").map((line, index) => {
    const cells = line.split(",");
    const get = (name: string) => (cells[cols.indexOf(name)] ?? "").trim();
    return { id: get("id") || `row-${index + 2}`, name: get("name"), email: get("email"), phone: get("phone") };
  });
}
