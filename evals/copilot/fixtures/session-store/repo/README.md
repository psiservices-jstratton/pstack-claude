# session-store

An in-memory session store with a byte budget. Each session is measured as UTF-8 JSON.

Reads count as use, and the least recently used sessions are removed first when the store is over budget. Setting an existing id replaces that session and its old byte count. `delete` and `clear` keep the reported byte count accurate.

Run `npm test` with Node 24.
