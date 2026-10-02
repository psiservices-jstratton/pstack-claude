import { test } from "node:test";
import assert from "node:assert/strict";
import { readAuditLog } from "../src/routes/audit.ts";
import { readDocument } from "../src/routes/read.ts";
import { updateDocument } from "../src/routes/update.ts";
import type { Request, Store, User } from "../src/types.ts";

function store(): Store {
  return {
    documents: new Map([["doc_1", { id: "doc_1", teamId: "team_a", ownerId: "u_owner", title: "Plan", body: "Ship it", confidential: false }]]),
    audit: [{ documentId: "doc_1", action: "created", at: "2026-04-01T00:00:00.000Z" }],
  };
}

function req(user: User, id = "doc_1", body?: Request["body"]): Request {
  return { user, params: { id }, body };
}

const owner: User = { id: "u_owner", role: "viewer", teamIds: ["team_a"] };
const teammate: User = { id: "u_editor", role: "editor", teamIds: ["team_a"] };
const outsider: User = { id: "u_out", role: "viewer", teamIds: ["team_b"] };

test("owners can read documents", () => {
  assert.equal(readDocument(req(owner), store()).status, 200);
});

test("editors on the team can update documents", () => {
  const data = store();
  const res = updateDocument(req(teammate, "doc_1", { title: "New" }), data);
  assert.deepEqual(res, { status: 200, body: { id: "doc_1", title: "New", body: "Ship it" } });
});

test("outsiders receive not found for reads", () => {
  assert.deepEqual(readDocument(req(outsider), store()), { status: 404, body: { error: "not_found" } });
});

test("auditors can read the audit log", () => {
  const auditor: User = { id: "u_audit", role: "auditor", teamIds: ["team_a"] };
  assert.equal(readAuditLog(req(auditor), store()).status, 200);
});
