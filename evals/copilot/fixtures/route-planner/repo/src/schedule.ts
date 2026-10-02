import type { Route } from "./graph.ts";

export type StopWindow = {
  depot: string;
  opens: number;
  closes: number;
};

export type StopEta = {
  depot: string;
  arrival: number;
  waits: number;
};

export function hasDepot(route: Route | null, depot: string): boolean {
  return route?.depots.includes(depot) ?? false;
}

export function estimateStops(route: Route, windows: readonly StopWindow[], startMinute: number): StopEta[] {
  const byDepot = new Map(windows.map((window) => [window.depot, window]));
  let minute = startMinute;
  return route.depots.map((depot, index) => {
    if (index > 0) minute += Math.ceil(route.cost / Math.max(1, route.depots.length - 1));
    const window = byDepot.get(depot);
    const waits = window && minute < window.opens ? window.opens - minute : 0;
    minute += waits;
    return { depot, arrival: minute, waits };
  });
}

export function missesWindow(stop: StopEta, windows: readonly StopWindow[]): boolean {
  const window = windows.find((item) => item.depot === stop.depot);
  return window ? stop.arrival > window.closes : false;
}

export function routeIsSchedulable(route: Route | null, windows: readonly StopWindow[], startMinute: number): boolean {
  if (!route) return false;
  return estimateStops(route, windows, startMinute).every((stop) => !missesWindow(stop, windows));
}

export function summarizeSchedule(route: Route | null, windows: readonly StopWindow[], startMinute: number): string {
  if (!route) return "no route";
  return estimateStops(route, windows, startMinute)
    .map((stop) => `${stop.depot}@${stop.arrival}`)
    .join(", ");
}
