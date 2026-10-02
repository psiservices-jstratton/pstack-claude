# Copilot eval calibration, 2026-09-26

This is the calibration pass for the expanded blinded eval of the pstack Copilot build. It ran on Copilot CLI 1.0.89-4 with the harness in [the harness README](../README.md). The plan was to run the baseline arm only on a pool of 15 to 20 tasks, and to keep 8 to 10 tasks whose baseline pass rate falls between about 30% and 70%. Those tasks would feed a main run: 3 runs per task per arm, two worker models from different vendors, and two blinded judges from other vendors, all within about 150 premium requests.

The main run does not fit, so this pass stops after calibration as instructed. Only 3 of the 15 tasks leave the baseline any room, and hardening the rest would push past the budget. A smaller design follows at the end.

## Design

- **Arm:** A only, the plain Copilot CLI with nothing installed, in an isolated `HOME` and `COPILOT_HOME`.
- **Worker:** `claude-sonnet-5`, 3 runs per task.
- **Tasks:** 15 new fixtures, 6 bugs, 3 features, 3 refactors, and 3 performance issues. They are listed in [the harness README](../README.md#fixtures). The 4 pilot fixtures were left out because both arms already scored 8/8 on them in the [pilot](pilot-2026-09-25.md).
- **Fixture validation:** `node evals/copilot/check-fixtures.mjs` passes for all 19 fixtures. Visible tests pass on the starting code, at least one hidden check fails on it, a harness-only `reference.patch` passes every check, and no file a candidate can see mentions the harness.
- **Grading:** hidden checks only. No judge ran, since there was no second arm to compare.

Raw outputs are in [2026-09-26-calibration/](2026-09-26-calibration/): [report.md](2026-09-26-calibration/report.md), [results.json](2026-09-26-calibration/results.json), one `.diff` and one compact `.events.jsonl` extract per run. Full workdirs, replies, and session state are archived under the gitignored `evals/copilot/archive/2026-09-26-calibration-*`.

## Fairness fixes made mid-calibration

A review of the fixtures after the first 30 runs found three problems. Each was fixed before the third rep.

- **cli-help** pinned the exact wrapped text. The check now asserts the behavior the prompt asks for: lines fit the width, continuation lines indent to the description column, word order is preserved, and a long word sits on its own line.
- **usage-exports** pinned a helper file name and loop text, and failed any `for` loop in an exporter, even per-product aggregation after grouping. The check now requires that no exporter builds dates from the range or from `event.occurredAt` itself, and that all three import one shared local module.
- **payout-split** expected a clawback of -100 in thirds to split as `[-34, -33, -33]`, the exact negation of the positive split. The README never said so, and floor-based answers are also defensible. The README now states that a clawback splits as the exact negation of the same positive payout.

The first 28 runs of the other tasks were regraded against the fixed checks with the new `--regrade` flag. The two early payout-split runs saw the old README, so they were dropped and 3 fresh runs replaced them.

## Results

Across all tasks, arm A passed every hidden check in 40 of 45 runs, 89% (95% Wilson interval 77% to 95%).

| Task | Kind | Hidden all-pass | 95% interval | Mean hidden | Failing check |
| --- | --- | --- | --- | --- | --- |
| catalog-cache | bug | 2/3 | 21% to 94% | 0.83 | r2 failed both failed-load checks |
| payout-split | bug | 2/3 | 21% to 94% | 0.92 | r1 failed the clawback check |
| reminder-scheduler | bug | 0/3 | 0% to 56% | 0.75 | all three failed "a skipped local minute rolls forward" |
| cli-help | feature | 3/3 | 44% to 100% | 1.00 | |
| doc-access | refactor | 3/3 | 44% to 100% | 1.00 | |
| event-hub | bug | 3/3 | 44% to 100% | 1.00 | |
| invoice-lifecycle | refactor | 3/3 | 44% to 100% | 1.00 | |
| log-query | perf | 3/3 | 44% to 100% | 1.00 | |
| order-feed | bug | 3/3 | 44% to 100% | 1.00 | |
| route-planner | perf | 3/3 | 44% to 100% | 1.00 | |
| session-store | bug | 3/3 | 44% to 100% | 1.00 | |
| settings-loader | feature | 3/3 | 44% to 100% | 1.00 | |
| slug-registry | feature | 3/3 | 44% to 100% | 1.00 | |
| stock-diff | perf | 3/3 | 44% to 100% | 1.00 | |
| usage-exports | refactor | 3/3 | 44% to 100% | 1.00 | |

Each run cost 1 premium request. Wall time totalled 2960 s, with a median of 55 s per run. No arm A session received the pstack routing context, which confirms that the isolated homes kept the plugin out of the baseline.

Every failing run still passed its own test suite, including the tests the candidate added. Four of the five misses share a pattern. The prompt names the main symptom, and the candidate fixes it. A second rule, stated in the README and living in a code path the prompt does not point to, stays broken. That was the daylight-saving gap in all three reminder-scheduler runs and clawback symmetry in one payout-split run. The fifth miss is different. catalog-cache run 2 added request coalescing but kept writing failed loads into the cache, so the outage symptom the prompt names was not fixed.

## Why the main run does not fit

The in-range set is catalog-cache and payout-split at 2/3, plus reminder-scheduler at 0/3, whose interval reaches 56%. That makes 3 tasks against a target of 8 to 10. The other 12 are at the ceiling for this worker.

Premium requests spent on this eval so far:

| Spend | Requests |
| --- | --- |
| Cost probes | 40.5 |
| Harness mechanics check (`claude-haiku-4.5`) | 0.33 |
| Calibration, 47 runs (45 kept, 2 dropped payout-split runs) | 47 |
| Total | 87.8 |

The first probe batch cost 38.5 requests of that 40.5. It sent one prompt to each of 8 models without knowing their multipliers, and this account bills `claude-opus-5.5` at 15, `gemini-3.8-flash` at 14, and `gpt-5.5` at 7.5 requests per prompt. The `/model` picker labels do not match these costs: it shows Gemini Flash as low cost. `claude-sonnet-5`, `gpt-6-sol`, `grok-4.7`, and `kimi-k3` each cost 1, and `claude-haiku-4.5` costs 0.33. Copilot bills each user prompt once, times the model's multiplier. Subagent and tool calls inside a session add nothing, so arm B costs the same per run as arm A.

The specified main run needs 8 in-range tasks. Hardening 5 or more ceiling fixtures and recalibrating them costs about 20 requests. The main run then needs about 72 new runs for sonnet B, GPT A, and GPT B, plus the judges. That comes to about 180 in total, over 150 even if every calibration run is reused as main-run arm A. `gpt-5.5` as the GPT worker is out of reach at 7.5 per run. `gpt-6-sol` is the 1x GPT model.

## Proposed smaller design

**Recommended, in a fresh budget cycle.** Harden 6 ceiling fixtures the way reminder-scheduler already works. Add a second rule to each README, implemented in a code path the prompt does not name, with a hidden check for it. Good candidates are event-hub, order-feed, session-store, settings-loader, slug-registry, and log-query. Recalibrate those 6 with sonnet at 3 runs (18 requests), and keep them if they land in range. Then run the main design on about 9 tasks.

| Piece | Runs |
| --- | --- |
| Sonnet A | reuse the 9 calibration runs for the 3 unchanged tasks, and the 18 recalibration runs |
| `gpt-6-sol` A | 27, which doubles as GPT calibration |
| Sonnet B | 27 |
| `gpt-6-sol` B | 27 |
| Judges `grok-4.7` and `kimi-k3`, one packet each | 2 |
| Total new | about 101, plus 10 to 20 for a second hardening pass |

Neither judge shares a vendor with either worker, so there is no self-vendor bias to report. With 27 runs per arm per worker, the two Wilson intervals separate only when pass rates differ by roughly 35 points or more (an estimate from the interval widths, not a power analysis). Smaller effects would not, and the judge preference and deterministic columns would carry the comparison.

**Fits the remaining budget now, not recommended.** Run the 3 in-range tasks only: sonnet B (9), `gpt-6-sol` A and B (18), and 2 judges, for 29 requests and about 117 in total. With 9 pairs per worker, even a jump from 67% to 100% would sit inside the intervals. `gpt-6-sol` has no calibration on these tasks, so it may be at the floor or the ceiling. This would be a direction check, not a result.

**Rejected.** A weaker 0.33x worker such as `claude-haiku-4.5` would pull more tasks into range cheaply. But 0.9.47 recorded Haiku below the model floor for pstack's setup and panel orchestration, so arm B would measure Haiku's compliance, not pstack.

## What this shows and what it does not

It shows that the plain Copilot CLI with `claude-sonnet-5` passes every hidden check in 40 of 45 runs, and that 4 of its 5 misses are documented secondary rules the prompt does not name. Most of this fixture pool is too easy to separate the arms for this worker. The difference only has room to appear on tasks with a second, documented, unnamed rule.

It does not measure pstack at all, because no arm B ran. It also does not measure any GPT worker. And with 3 runs per task, it cannot tell a 67% task from a 100% task: both intervals span about 20% to 94%.
