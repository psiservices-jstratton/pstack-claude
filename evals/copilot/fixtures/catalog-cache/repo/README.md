# catalog-cache

A small read-through cache for product catalog lookups. `CatalogCache` wraps an upstream fetch function and stores item data for a configured number of milliseconds.

Repeated reads for a fresh item should use the cached result. Once an entry expires, the next read should ask upstream again. Different item ids are independent, and `getMany` returns results in the same order as the input ids.

Run `npm test` with Node 24.
