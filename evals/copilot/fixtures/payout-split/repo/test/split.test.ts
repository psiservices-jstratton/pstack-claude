import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPayout } from "../src/split.ts";
import { summarizeSplit } from "../src/summary.ts";

const recipients = [
  { id: "artist", weight: 3 },
  { id: "label", weight: 1 },
];

test("splits an even proportional payout", () => {
  assert.deepEqual(splitPayout(1000, recipients), [
    { recipientId: "artist", cents: 750 },
    { recipientId: "label", cents: 250 },
  ]);
});

test("all zero weights receive zero", () => {
  assert.deepEqual(splitPayout(999, [{ id: "none", weight: 0 }]), [{ recipientId: "none", cents: 0 }]);
});

test("rejects negative weights", () => {
  assert.throws(() => splitPayout(100, [{ id: "bad", weight: -1 }]), RangeError);
});

test("summary uses the split order", () => {
  assert.equal(summarizeSplit(400, recipients), "artist:300,label:100");
});
