import { test } from "node:test";
import assert from "node:assert/strict";
import { cheapestRoute } from "../src/planner.ts";
import type { Road } from "../src/graph.ts";

test("equal costs prefer fewer hops", () => {
  const roads: Road[] = [
    { from: "S", to: "A", cost: 1 },
    { from: "A", to: "T", cost: 1 },
    { from: "S", to: "T", cost: 2 },
  ];
  assert.deepEqual(cheapestRoute(roads, "S", "T"), { depots: ["S", "T"], cost: 2 });
});

test("equal cost and hop count prefer lexicographically smallest sequence", () => {
  const roads: Road[] = [
    { from: "S", to: "C", cost: 1 },
    { from: "C", to: "T", cost: 1 },
    { from: "S", to: "B", cost: 1 },
    { from: "B", to: "T", cost: 1 },
  ];
  assert.deepEqual(cheapestRoute(roads, "S", "T")?.depots, ["S", "B", "T"]);
});

test("zero-cost roads work and unreachable destinations return null", () => {
  const roads: Road[] = [
    { from: "A", to: "B", cost: 0 },
    { from: "B", to: "C", cost: 0 },
    { from: "X", to: "Y", cost: 0 },
  ];
  assert.deepEqual(cheapestRoute(roads, "A", "C"), { depots: ["A", "B", "C"], cost: 0 });
  assert.equal(cheapestRoute(roads, "C", "A"), null);
});
