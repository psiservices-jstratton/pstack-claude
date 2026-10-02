import { test } from "node:test";
import assert from "node:assert/strict";
import { EventHub } from "../src/event-hub.ts";

type Events = { audit: string };

test("a one-time listener does not skip the next listener on that emit", () => {
  const hub = new EventHub<Events>();
  const calls: string[] = [];
  hub.on("audit", () => calls.push("first"));
  hub.once("audit", () => calls.push("once"));
  hub.on("audit", () => calls.push("after"));

  hub.emit("audit", "a");
  hub.emit("audit", "b");
  assert.deepEqual(calls, ["first", "once", "after", "first", "after"]);
});

test("a listener removing itself during emit does not skip the next listener", () => {
  const hub = new EventHub<Events>();
  const calls: string[] = [];
  let stop = () => false;
  stop = hub.on("audit", () => {
    calls.push("self");
    assert.equal(stop(), true);
  });
  hub.on("audit", () => calls.push("next"));

  hub.emit("audit", "a");
  hub.emit("audit", "b");
  assert.deepEqual(calls, ["self", "next", "next"]);
});

test("a listener added during emit waits until the next emit", () => {
  const hub = new EventHub<Events>();
  const calls: string[] = [];
  hub.on("audit", () => {
    calls.push("first");
    hub.on("audit", () => calls.push("late"));
  });
  hub.on("audit", () => calls.push("second"));

  hub.emit("audit", "a");
  assert.deepEqual(calls, ["first", "second"]);
  hub.emit("audit", "b");
  assert.deepEqual(calls, ["first", "second", "first", "second", "late"]);
});

test("once still fires exactly once", () => {
  const hub = new EventHub<Events>();
  let count = 0;
  hub.once("audit", () => {
    count++;
  });
  hub.emit("audit", "a");
  hub.emit("audit", "b");
  hub.emit("audit", "c");
  assert.equal(count, 1);
});
