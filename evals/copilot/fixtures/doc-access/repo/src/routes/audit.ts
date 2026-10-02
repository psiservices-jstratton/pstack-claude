import type { Request, Response, Store } from "../types.ts";

export function readAuditLog(req: Request, store: Store): Response {
  const doc = store.documents.get(req.params.id);
  if (!doc) return { status: 404, body: { error: "not_found" } };

  if (!req.user.teamIds.includes(doc.teamId)) {
    return { status: 404, body: { error: "not_found" } };
  }
  if (req.user.role !== "auditor") {
    return { status: 403, body: { error: "forbidden" } };
  }

  return {
    status: 200,
    body: store.audit.filter((entry) => entry.documentId === doc.id).map((entry) => ({ action: entry.action, at: entry.at })),
  };
}
