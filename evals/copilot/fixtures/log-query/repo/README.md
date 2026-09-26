# log-query

Filters raw service logs for the support console. The search accepts multiple terms, ignores blank terms, and returns the original log lines that contain every term.

Search terms are literal text, not patterns. Matching is case-insensitive, result order follows the input order, and repeated identical lines stay repeated.

Run the tests with `npm test` (Node 24, no dependencies).
