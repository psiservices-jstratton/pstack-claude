export type Role = "viewer" | "editor" | "admin" | "auditor";

export type User = {
  id: string;
  role: Role;
  teamIds: string[];
};

export type DocumentRecord = {
  id: string;
  teamId: string;
  ownerId: string;
  title: string;
  body: string;
  confidential: boolean;
};

export type AuditEntry = {
  documentId: string;
  action: string;
  at: string;
};

export type Store = {
  documents: Map<string, DocumentRecord>;
  audit: AuditEntry[];
};

export type Request = {
  user: User;
  params: { id: string };
  body?: { title?: string; body?: string };
};

export type Response = {
  status: number;
  body: unknown;
};
