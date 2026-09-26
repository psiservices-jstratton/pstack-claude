# route-planner

Plans truck routes between depots on a directed road graph. Road costs are non-negative integers, and a cost of zero is allowed for yard transfers.

`cheapestRoute` returns the lowest total cost. If two routes have the same cost, it returns the one with fewer hops. If cost and hop count are both tied, it returns the lexicographically smallest depot sequence. If the destination cannot be reached, it returns `null`.

Run the tests with `npm test` (Node 24, no dependencies).
