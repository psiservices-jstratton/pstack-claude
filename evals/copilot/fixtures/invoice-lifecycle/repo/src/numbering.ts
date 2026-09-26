export type NumberParts = {
  prefix: string;
  sequence: number;
};

export function parseInvoiceNumber(value: string): NumberParts {
  const match = /^(?<prefix>[A-Z]+)-(?<sequence>\d+)$/.exec(value);
  if (!match?.groups) throw new Error("invalid invoice number");
  return { prefix: match.groups.prefix, sequence: Number(match.groups.sequence) };
}

export function nextInvoiceNumber(value: string): string {
  const parts = parseInvoiceNumber(value);
  return `${parts.prefix}-${String(parts.sequence + 1).padStart(6, "0")}`;
}

export function firstInvoiceNumber(prefix: string): string {
  if (!/^[A-Z]+$/.test(prefix)) throw new Error("prefix must be uppercase letters");
  return `${prefix}-000001`;
}
