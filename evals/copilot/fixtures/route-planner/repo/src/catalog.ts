import type { Road } from "./graph.ts";

export function twoWay(from: string, to: string, cost: number): Road[] {
  return [
    { from, to, cost },
    { from: to, to: from, cost },
  ];
}

export function totalRoadCost(roads: readonly Road[]): number {
  return roads.reduce((sum, road) => sum + road.cost, 0);
}
