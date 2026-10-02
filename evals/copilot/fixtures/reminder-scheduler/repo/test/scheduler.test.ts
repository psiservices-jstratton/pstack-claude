import { test } from "node:test";
import assert from "node:assert/strict";
import { dueReminders, nextDelivery } from "../src/scheduler.ts";
import type { Reminder } from "../src/types.ts";

const base: Reminder = {
  id: "r1",
  userId: "u1",
  timeZone: "America/New_York",
  hour: 9,
  minute: 0,
  recurrence: "daily",
};

test("schedules today's local wall time when it is still ahead", () => {
  assert.equal(nextDelivery(base, "2026-01-15T13:00:00.000Z")?.deliverAt, "2026-01-15T14:00:00.000Z");
});

test("moves to the next local day after today's time has passed", () => {
  assert.equal(nextDelivery(base, "2026-01-15T15:00:00.000Z")?.deliverAt, "2026-01-16T14:00:00.000Z");
});

test("weekly reminders advance by one week between ordinary winter dates", () => {
  const weekly = { ...base, recurrence: "weekly" as const, lastSentAt: "2026-01-05T14:00:00.000Z" };
  assert.equal(nextDelivery(weekly, "2026-01-06T12:00:00.000Z")?.deliverAt, "2026-01-12T14:00:00.000Z");
});

test("paused reminders are omitted from the due list", () => {
  assert.deepEqual(dueReminders([{ ...base, paused: true }], "2026-01-15T13:00:00.000Z"), []);
});

test("a zone without seasonal clock changes keeps its UTC time in March", () => {
  const phoenix = { ...base, timeZone: "America/Phoenix", lastSentAt: "2026-03-07T16:00:00.000Z" };
  assert.equal(nextDelivery(phoenix, "2026-03-08T01:00:00.000Z")?.deliverAt, "2026-03-08T16:00:00.000Z");
});
