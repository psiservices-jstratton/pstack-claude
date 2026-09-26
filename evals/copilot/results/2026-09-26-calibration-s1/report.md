# Copilot A/B run 2026-09-26T05-56-44

Arms: A = plain Copilot CLI, B = Copilot CLI with pstack installed. Models: claude-sonnet-5. Reps: 2. Judge: none.

## Pass rate per arm

| model | arm | runs | hidden all-pass | premium requests | wall s (total) | wall s (median) | routing context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5 | A | 30 | 23/30 (77%, 95% CI 59% to 88%) | 30 | 2046 | 58 | 0 |

## Pass rate per task

| task | model | arm | hidden all-pass | mean hidden | errors |
| --- | --- | --- | --- | --- | --- |
| catalog-cache | claude-sonnet-5 | A | 1/2 (50%, 95% CI 9% to 91%) | 0.75 | 0 |
| cli-help | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| doc-access | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| event-hub | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| invoice-lifecycle | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| log-query | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| order-feed | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| payout-split | claude-sonnet-5 | A | 0/2 (0%, 95% CI 0% to 66%) | 0.75 | 0 |
| reminder-scheduler | claude-sonnet-5 | A | 0/2 (0%, 95% CI 0% to 66%) | 0.75 | 0 |
| route-planner | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| session-store | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| settings-loader | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| slug-registry | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| stock-diff | claude-sonnet-5 | A | 2/2 (100%, 95% CI 34% to 100%) | 1.00 | 0 |
| usage-exports | claude-sonnet-5 | A | 0/2 (0%, 95% CI 0% to 66%) | 0.50 | 0 |

## Deterministic results

| task | model | rep | arm | hidden | own suite | files | src +/- | test + | comments | ran tests | skills | subagents | premium | wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| catalog-cache | claude-sonnet-5 | 1 | A | 4/4 | 7/7 | 2 | +15/-2 | 76 | 8 | yes | none | none | 1 | 105 |
| catalog-cache | claude-sonnet-5 | 2 | A | 2/4 | 5/5 | 2 | +25/-9 | 56 | 3 | yes | none | none | 1 | 87 |
| cli-help | claude-sonnet-5 | 1 | A | 3/3 | 6/6 | 2 | +44/-2 | 38 | 5 | yes | none | none | 1 | 59 |
| cli-help | claude-sonnet-5 | 2 | A | 3/3 | 2/2 | 1 | +50/-2 | 0 | 7 | yes | none | none | 1 | 57 |
| doc-access | claude-sonnet-5 | 1 | A | 2/2 | 4/4 | 4 | +54/-37 | 0 | 6 | yes | none | none | 1 | 50 |
| doc-access | claude-sonnet-5 | 2 | A | 2/2 | 4/4 | 4 | +59/-39 | 0 | 8 | yes | none | none | 1 | 61 |
| event-hub | claude-sonnet-5 | 1 | A | 4/4 | 4/4 | 1 | +2/-1 | 0 | 0 | yes | none | none | 1 | 34 |
| event-hub | claude-sonnet-5 | 2 | A | 4/4 | 5/5 | 2 | +4/-1 | 12 | 3 | yes | none | none | 1 | 27 |
| invoice-lifecycle | claude-sonnet-5 | 1 | A | 3/3 | 4/4 | 1 | +67/-19 | 0 | 4 | yes | none | none | 1 | 121 |
| invoice-lifecycle | claude-sonnet-5 | 2 | A | 3/3 | 4/4 | 1 | +54/-19 | 0 | 4 | yes | none | none | 1 | 96 |
| log-query | claude-sonnet-5 | 1 | A | 4/4 | 5/5 | 1 | +3/-3 | 0 | 0 | yes | none | none | 1 | 25 |
| log-query | claude-sonnet-5 | 2 | A | 4/4 | 5/5 | 1 | +4/-3 | 0 | 1 | yes | none | none | 1 | 21 |
| order-feed | claude-sonnet-5 | 1 | A | 3/3 | 7/7 | 3 | +14/-5 | 24 | 1 | yes | none | none | 1 | 64 |
| order-feed | claude-sonnet-5 | 2 | A | 3/3 | 5/5 | 3 | +12/-5 | 12 | 2 | yes | none | none | 1 | 59 |
| payout-split | claude-sonnet-5 | 1 | A | 3/4 | 4/4 | 1 | +27/-4 | 0 | 4 | yes | none | none | 1 | 65 |
| payout-split | claude-sonnet-5 | 2 | A | 3/4 | 4/4 | 1 | +38/-4 | 0 | 7 | yes | none | none | 1 | 72 |
| reminder-scheduler | claude-sonnet-5 | 1 | A | 3/4 | 7/7 | 2 | +5/-10 | 10 | 0 | yes | none | none | 1 | 51 |
| reminder-scheduler | claude-sonnet-5 | 2 | A | 3/4 | 8/8 | 2 | +9/-4 | 15 | 3 | yes | none | none | 1 | 53 |
| route-planner | claude-sonnet-5 | 1 | A | 4/4 | 4/4 | 1 | +117/-29 | 0 | 16 | yes | none | none | 1 | 213 |
| route-planner | claude-sonnet-5 | 2 | A | 4/4 | 4/4 | 1 | +124/-32 | 0 | 11 | yes | none | none | 1 | 250 |
| session-store | claude-sonnet-5 | 1 | A | 4/4 | 3/3 | 1 | +14/-1 | 0 | 4 | yes | none | none | 1 | 29 |
| session-store | claude-sonnet-5 | 2 | A | 4/4 | 3/3 | 1 | +12/-1 | 0 | 2 | yes | none | none | 1 | 27 |
| settings-loader | claude-sonnet-5 | 1 | A | 4/4 | 7/7 | 5 | +63/-1 | 33 | 0 | yes | none | none | 1 | 59 |
| settings-loader | claude-sonnet-5 | 2 | A | 4/4 | 7/7 | 5 | +64/-1 | 20 | 0 | yes | none | none | 1 | 58 |
| slug-registry | claude-sonnet-5 | 1 | A | 4/4 | 4/4 | 2 | +28/-1 | 0 | 5 | yes | none | none | 1 | 44 |
| slug-registry | claude-sonnet-5 | 2 | A | 4/4 | 7/7 | 4 | +26/-1 | 18 | 5 | yes | none | none | 1 | 53 |
| stock-diff | claude-sonnet-5 | 1 | A | 4/4 | 3/3 | 1 | +45/-42 | 0 | 0 | yes | none | none | 1 | 50 |
| stock-diff | claude-sonnet-5 | 2 | A | 4/4 | 3/3 | 1 | +23/-35 | 0 | 0 | yes | none | none | 1 | 37 |
| usage-exports | claude-sonnet-5 | 1 | A | 1/2 | 3/3 | 4 | +79/-57 | 0 | 11 | yes | none | none | 1 | 48 |
| usage-exports | claude-sonnet-5 | 2 | A | 1/2 | 3/3 | 4 | +83/-52 | 0 | 12 | yes | none | none | 1 | 71 |

## Blinded judge

No judge verdict.
