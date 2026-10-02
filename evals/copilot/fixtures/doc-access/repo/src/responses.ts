import type { DocumentRecord, Response } from "./types.ts";

export function notFound(): Response {
  return { status: 404, body: { error: "not_found" } };
}

export function forbidden(): Response {
  return { status: 403, body: { error: "forbidden" } };
}

export function documentBody(doc: DocumentRecord): Response {
  return {
    status: 200,
    body: { id: doc.id, title: doc.title, body: doc.body },
  };
}

export function savedBody(doc: DocumentRecord): Response {
  return {
    status: 200,
    body: { id: doc.id, title: doc.title, body: doc.body },
  };
}
