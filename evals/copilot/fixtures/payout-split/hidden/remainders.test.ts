import { test } from "node:test";
import assert from "node:assert/strict";
import { splitPayout } from "../src/split.ts";

const thirds = [
  { id: "a", weight: 1 },
  { id: "b", weight: 1 },
  { id: "c", weight: 1 },
];

test("fractional cents are allocated so the parts sum to the payout", () => {
  const shares = splitPayout(100, thirds);
  assert.deepEqual(shares.map((share) => share.cents), [34, 33, 33]);
  assert.equal(shares.reduce((sum, share) => sum + share.cents, 0), 100);
});

test("ties for extra cents go to earlier recipients deterministically", () => {
  assert.deepEqual(splitPayout(101, thirds).map((share) => share.cents), [34, 34, 33]);
});

test("negative refund clawbacks also sum exactly", () => {
  const shares = splitPayout(-100, thirds);
  assert.deepEqual(shares.map((share) => share.cents), [-34, -33, -33]);
  assert.equal(shares.reduce((sum, share) => sum + share.cents, 0), -100);
});

test("zero-weight recipients stay at zero while remaining cents are assigned", () => {
  assert.deepEqual(splitPayout(101, [
    { id: "left", weight: 1 },
    { id: "zero", weight: 0 },
    { id: "right", weight: 1 },
  ]).map((share) => share.cents), [51, 0, 50]);
});
