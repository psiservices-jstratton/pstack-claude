import type { Request, Response, Store } from "../types.ts";

export function readDocument(req: Request, store: Store): Response {
  const doc = store.documents.get(req.params.id);
  if (!doc) return { status: 404, body: { error: "not_found" } };

  if (req.user.role === "admin") {
    return { status: 200, body: { id: doc.id, title: doc.title, body: doc.body } };
  }
  if (doc.ownerId === req.user.id) {
    return { status: 200, body: { id: doc.id, title: doc.title, body: doc.body } };
  }
  if (req.user.teamIds.includes(doc.teamId) && (!doc.confidential || req.user.role === "editor")) {
    return { status: 200, body: { id: doc.id, title: doc.title, body: doc.body } };
  }

  return { status: 404, body: { error: "not_found" } };
}
