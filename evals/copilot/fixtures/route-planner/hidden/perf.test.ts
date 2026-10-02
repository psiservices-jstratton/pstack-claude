import { test } from "node:test";
import assert from "node:assert/strict";
import { cheapestRoute } from "../src/planner.ts";
import type { Road } from "../src/graph.ts";

function depot(index: number): string {
  return `D${String(index).padStart(5, "0")}`;
}

function buildRoads(count: number): Road[] {
  const roads: Road[] = [];
  for (let i = 0; i < count - 1; i++) roads.push({ from: depot(i), to: depot(i + 1), cost: 1 });
  for (let i = 0; i + 40 < count; i += 40) roads.push({ from: depot(i), to: depot(i + 40), cost: 40 });
  for (let i = 0; i < 4_000; i++) roads.push({ from: `Z${i}`, to: `Z${i}-end`, cost: 1 });
  return roads;
}

test("large depot map routes quickly", () => {
  const roads = buildRoads(14_000);
  const start = performance.now();
  const route = cheapestRoute(roads, depot(0), depot(13_999));
  const elapsed = performance.now() - start;
  assert.equal(route?.cost, 13_999);
  assert.equal(route?.depots.at(0), depot(0));
  assert.equal(route?.depots.at(-1), depot(13_999));
  assert.ok((route?.depots.length ?? 0) < 500, `expected shortcuts, got ${route?.depots.length}`);
  assert.ok(elapsed < 1500, `route search took ${Math.round(elapsed)}ms`);
});
