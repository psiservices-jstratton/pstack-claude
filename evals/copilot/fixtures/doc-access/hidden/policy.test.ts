import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { readAuditLog } from "../src/routes/audit.ts";
import { readDocument } from "../src/routes/read.ts";
import { updateDocument } from "../src/routes/update.ts";
import type { Request, Store, User } from "../src/types.ts";

function store(): Store {
  return {
    documents: new Map([
      ["public", { id: "public", teamId: "team_a", ownerId: "owner", title: "Public", body: "ok", confidential: false }],
      ["secret", { id: "secret", teamId: "team_a", ownerId: "owner", title: "Secret", body: "shh", confidential: true }],
    ]),
    audit: [{ documentId: "secret", action: "viewed", at: "2026-04-02T00:00:00.000Z" }],
  };
}

function req(user: User, id: string, body?: Request["body"]): Request {
  return { user, params: { id }, body };
}

test("responses keep the route-specific access semantics", () => {
  const ownerViewer: User = { id: "owner", role: "viewer", teamIds: ["team_a"] };
  const sameTeamViewer: User = { id: "viewer", role: "viewer", teamIds: ["team_a"] };
  const admin: User = { id: "admin", role: "admin", teamIds: ["team_a"] };
  const auditor: User = { id: "auditor", role: "auditor", teamIds: ["team_a"] };
  const outsider: User = { id: "out", role: "editor", teamIds: ["team_b"] };

  assert.deepEqual(readDocument(req(outsider, "secret"), store()), { status: 404, body: { error: "not_found" } });
  assert.equal(updateDocument(req(ownerViewer, "secret", { body: "mine" }), store()).status, 200);
  assert.deepEqual(updateDocument(req(sameTeamViewer, "public", { title: "No" }), store()), { status: 403, body: { error: "forbidden" } });
  assert.equal(readDocument(req(admin, "secret"), store()).status, 200);
  assert.equal(updateDocument(req(admin, "secret", { title: "Admin" }), store()).status, 200);
  assert.deepEqual(readAuditLog(req(admin, "secret"), store()), { status: 403, body: { error: "forbidden" } });
  assert.equal(readAuditLog(req(auditor, "secret"), store()).status, 200);
});

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.endsWith(".test.ts") ? [path] : [];
  });
}

test("route handlers delegate access decisions to one shared module", () => {
  for (const name of ["read.ts", "update.ts", "audit.ts"]) {
    const text = readFileSync(join("src/routes", name), "utf8");
    assert.doesNotMatch(text, /\buser\.(role|id|teamIds)\b|\bdoc\.(ownerId|teamId|confidential)\b/, `${name} still contains direct access checks`);
  }
  const policyFiles = sources("src").filter((file) => !file.includes(`${join("src", "routes")}`) && /\buser\.(role|id|teamIds)\b|\bdoc\.(ownerId|teamId|confidential)\b/.test(readFileSync(file, "utf8")));
  assert.equal(policyFiles.length, 1, `expected one shared policy module, found ${policyFiles.join(", ")}`);
});
