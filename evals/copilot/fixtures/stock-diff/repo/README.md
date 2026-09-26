# stock-diff

Compares two inventory snapshots from store systems. Each row has a SKU, quantity, and location. Multiple rows for the same trimmed SKU and trimmed location are summed before the report is built; SKU matching ignores case.

The report lists added items first, then changed items, then removed items. Items inside each group are sorted by SKU and then by location. Reported SKUs are trimmed and uppercased.

Run the tests with `npm test` (Node 24, no dependencies).
