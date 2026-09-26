# payout-split

Splits integer-cent payouts across recipients by non-negative weight. The shares must always sum exactly to the original amount.

Rules:

- Positive amounts represent payouts; negative amounts represent refund clawbacks. A clawback splits as the exact negation of the same positive payout.
- A recipient with weight `0` receives `0`.
- When fractional cents remain after proportional allocation, assign the extra cent to the largest fractional remainders. Exact ties go to earlier recipients in the input list.
- If every recipient has zero weight, every share is `0`.

Run the tests with `npm test` (Node 24, no dependencies).
