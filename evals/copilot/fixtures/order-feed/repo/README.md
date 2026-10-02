# order-feed

Provides cursor pagination for partner order syncs.

The public feed is ordered by `createdAt`. Flash sales can create many orders with the same timestamp, so ties are part of normal data. The feed must use `id` as the stable tie-breaker, and the requested direction applies to both `createdAt` and the tie-breaker. Cursor tokens are opaque strings, but they must contain enough position data to resume without skipping or repeating an order.

Run the tests with `npm test` (Node 24, no dependencies).
