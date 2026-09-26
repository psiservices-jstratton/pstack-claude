export type Cursor = { createdAt: string };

export function encodeCursor(cursor: Cursor): string {
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeCursor(token: string | undefined): Cursor | undefined {
  if (!token) return undefined;
  try {
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8")) as Partial<Cursor>;
    return typeof parsed.createdAt === "string" ? { createdAt: parsed.createdAt } : undefined;
  } catch {
    return undefined;
  }
}
