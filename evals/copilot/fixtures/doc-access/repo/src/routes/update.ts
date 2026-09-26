import type { Request, Response, Store } from "../types.ts";

export function updateDocument(req: Request, store: Store): Response {
  const doc = store.documents.get(req.params.id);
  if (!doc) return { status: 404, body: { error: "not_found" } };

  if (req.user.role === "admin") {
    const updated = { ...doc, ...req.body };
    store.documents.set(doc.id, updated);
    return { status: 200, body: { id: updated.id, title: updated.title, body: updated.body } };
  }
  if (doc.ownerId === req.user.id) {
    const updated = { ...doc, ...req.body };
    store.documents.set(doc.id, updated);
    return { status: 200, body: { id: updated.id, title: updated.title, body: updated.body } };
  }
  if (!req.user.teamIds.includes(doc.teamId)) {
    return { status: 404, body: { error: "not_found" } };
  }
  if (req.user.role !== "editor") {
    return { status: 403, body: { error: "forbidden" } };
  }

  const updated = { ...doc, ...req.body };
  store.documents.set(doc.id, updated);
  return { status: 200, body: { id: updated.id, title: updated.title, body: updated.body } };
}
