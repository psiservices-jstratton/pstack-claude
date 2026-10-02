import { test } from "node:test";
import assert from "node:assert/strict";
import { EventHub } from "../src/event-hub.ts";
import { AuditTrail, type AppEvents } from "../src/audit.ts";
import { NoticeBoard } from "../src/notifications.ts";

test("listeners run in registration order", () => {
  const hub = new EventHub<AppEvents>();
  const calls: string[] = [];
  hub.on("notice", (message) => calls.push(`a:${message}`));
  hub.on("notice", (message) => calls.push(`b:${message}`));

  hub.emit("notice", "ready");
  assert.deepEqual(calls, ["a:ready", "b:ready"]);
});

test("off removes a listener for later emits", () => {
  const hub = new EventHub<AppEvents>();
  const calls: string[] = [];
  const stop = hub.on("notice", (message) => calls.push(message));

  hub.emit("notice", "first");
  assert.equal(stop(), true);
  hub.emit("notice", "second");
  assert.deepEqual(calls, ["first"]);
  assert.equal(hub.listenerCount("notice"), 0);
});

test("once runs once", () => {
  const hub = new EventHub<AppEvents>();
  let count = 0;
  hub.once("notice", () => {
    count++;
  });

  hub.emit("notice", "one");
  hub.emit("notice", "two");
  assert.equal(count, 1);
});

test("audit and notice helpers attach normal listeners", () => {
  const hub = new EventHub<AppEvents>();
  const audit = new AuditTrail();
  const board = new NoticeBoard();
  audit.attachTo(hub);
  board.attachTo(hub);

  hub.emit("audit", { actor: "sam", action: "open", entityId: "case-7" });
  hub.emit("notice", " shipped ");
  assert.deepEqual(audit.events, ["sam:open:case-7"]);
  assert.deepEqual(board.messages, ["shipped"]);
});
