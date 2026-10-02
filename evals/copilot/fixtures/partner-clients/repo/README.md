# partner-clients

HTTP clients for the shipping, payments, and tax partners. Each client takes an `http` function and a `sleep` function, so callers and tests can swap the transport and the clock.

Run the tests with `npm test` (Node 24, no dependencies).
