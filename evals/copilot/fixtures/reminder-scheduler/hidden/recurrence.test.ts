import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDelivery } from "../src/scheduler.ts";
import type { Reminder } from "../src/types.ts";

const morning: Reminder = {
  id: "ny-morning",
  userId: "u-new-york",
  timeZone: "America/New_York",
  hour: 9,
  minute: 0,
  recurrence: "daily",
};

test("daily New York reminders stay at 09:00 after spring clocks change", () => {
  const reminder = { ...morning, lastSentAt: "2026-03-07T14:00:00.000Z" };
  assert.equal(nextDelivery(reminder, "2026-03-08T12:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
});

test("weekly New York reminders use the same wall-clock rule", () => {
  const reminder = { ...morning, recurrence: "weekly" as const, lastSentAt: "2026-03-01T14:00:00.000Z" };
  assert.equal(nextDelivery(reminder, "2026-03-08T12:00:00.000Z")?.deliverAt, "2026-03-08T13:00:00.000Z");
});

test("a skipped local minute rolls forward to the next valid minute", () => {
  const reminder = { ...morning, id: "gap", hour: 2, minute: 30 };
  assert.equal(nextDelivery(reminder, "2026-03-08T06:45:00.000Z")?.deliverAt, "2026-03-08T07:00:00.000Z");
});

test("a zone without seasonal clock changes is not shifted", () => {
  const reminder = { ...morning, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
  assert.equal(nextDelivery(reminder, "2026-03-08T08:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");
});
