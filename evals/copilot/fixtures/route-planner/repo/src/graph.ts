export type Road = {
  from: string;
  to: string;
  cost: number;
};

export type Route = {
  depots: string[];
  cost: number;
};

export function allDepots(roads: readonly Road[], start: string, goal: string): string[] {
  const depots = new Set<string>([start, goal]);
  for (const road of roads) {
    depots.add(road.from);
    depots.add(road.to);
  }
  return [...depots];
}

export function outgoingRoads(roads: readonly Road[], depot: string): Road[] {
  return roads.filter((road) => road.from === depot).sort((a, b) => a.to.localeCompare(b.to));
}
