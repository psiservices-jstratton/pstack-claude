import type { Route } from "./graph.ts";

export function formatRoute(route: Route | null): string {
  if (!route) return "unreachable";
  return `${route.depots.join(" -> ")} ($${route.cost})`;
}
