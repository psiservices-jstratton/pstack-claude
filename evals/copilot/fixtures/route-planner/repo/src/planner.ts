import { allDepots, outgoingRoads, type Road, type Route } from "./graph.ts";

type BestRoute = {
  cost: number;
  hops: number;
  depots: string[];
};

function sequenceKey(depots: readonly string[]): string {
  return depots.join("\u0000");
}

function compareRoute(a: BestRoute, b: BestRoute): number {
  if (a.cost !== b.cost) return a.cost - b.cost;
  if (a.hops !== b.hops) return a.hops - b.hops;
  return sequenceKey(a.depots).localeCompare(sequenceKey(b.depots));
}

export function cheapestRoute(roads: readonly Road[], start: string, goal: string): Route | null {
  const unvisited = new Set(allDepots(roads, start, goal));
  const best = new Map<string, BestRoute>();
  best.set(start, { cost: 0, hops: 0, depots: [start] });

  while (unvisited.size > 0) {
    let current: string | undefined;
    let currentBest: BestRoute | undefined;
    for (const depot of unvisited) {
      const route = best.get(depot);
      if (!route) continue;
      if (!currentBest || compareRoute(route, currentBest) < 0) {
        current = depot;
        currentBest = route;
      }
    }

    if (!current || !currentBest) return null;
    if (current === goal) return { depots: currentBest.depots, cost: currentBest.cost };
    unvisited.delete(current);

    for (const road of outgoingRoads(roads, current)) {
      if (road.cost < 0) throw new RangeError("Road costs must be non-negative");
      if (!unvisited.has(road.to)) continue;
      const next: BestRoute = {
        cost: currentBest.cost + road.cost,
        hops: currentBest.hops + 1,
        depots: [...currentBest.depots, road.to],
      };
      const previous = best.get(road.to);
      if (!previous || compareRoute(next, previous) < 0) best.set(road.to, next);
    }
  }

  return null;
}
