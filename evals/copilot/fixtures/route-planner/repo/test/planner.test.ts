import { test } from "node:test";
import assert from "node:assert/strict";
import { cheapestRoute } from "../src/planner.ts";
import { formatRoute } from "../src/format.ts";
import { twoWay, totalRoadCost } from "../src/catalog.ts";
import type { Road } from "../src/graph.ts";
import { hasDepot, routeIsSchedulable, summarizeSchedule } from "../src/schedule.ts";

test("finds the cheapest directed route", () => {
  const roads: Road[] = [
    { from: "A", to: "B", cost: 4 },
    { from: "A", to: "C", cost: 2 },
    { from: "C", to: "B", cost: 1 },
    { from: "B", to: "D", cost: 3 },
    { from: "C", to: "D", cost: 8 },
  ];
  assert.deepEqual(cheapestRoute(roads, "A", "D"), { depots: ["A", "C", "B", "D"], cost: 6 });
});

test("formats missing and present routes", () => {
  assert.equal(formatRoute(null), "unreachable");
  assert.equal(formatRoute({ depots: ["A", "B"], cost: 7 }), "A -> B ($7)");
});

test("catalog helpers make symmetric roads", () => {
  const roads = twoWay("N", "S", 5);
  assert.equal(totalRoadCost(roads), 10);
  assert.deepEqual(roads.map((road) => road.from), ["N", "S"]);
});


test("schedule helpers work with planned routes", () => {
  const route = { depots: ["A", "B", "C"], cost: 10 };
  assert.equal(hasDepot(route, "B"), true);
  assert.equal(routeIsSchedulable(route, [{ depot: "C", opens: 0, closes: 40 }], 5), true);
  assert.equal(summarizeSchedule(route, [], 5), "A@5, B@10, C@15");
});
