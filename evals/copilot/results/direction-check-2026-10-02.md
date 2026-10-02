# Copilot eval direction check, 2026-10-02

This is a direction check, not a result. It runs the blinded A/B design on the only 3 tasks the [calibration](calibration-2026-09-26.md) found in range, with 9 pairs per worker. At this size the 95% intervals for every arm overlap, so nothing here can show that pstack helps or hurts on the Copilot CLI. It can only say which way the signals lean and whether the harness, the hook, and the routing behave as intended under a second worker model.

## Design

- **Tasks:** catalog-cache, payout-split, and reminder-scheduler, all bug fixes, 3 runs each. They are the in-range tasks from calibration.
- **Arms:** A is the plain Copilot CLI with nothing installed. B is the Copilot CLI with pstack installed and a pre-written model sheet. Every run used its own isolated `HOME` and `COPILOT_HOME`.
- **Workers:** `claude-sonnet-5` and `gpt-6-sol`. Sonnet arm A reuses the 9 calibration runs on these tasks, regraded against the same fixtures (unchanged since `770c3be`). The other 27 runs are new.
- **Sheets in arm B:** every role set to the worker model, and the panel set to the worker plus `claude-sonnet-5` and `grok-4.7`, deduplicated. Sonnet's panel was `claude-sonnet-5, grok-4.7`. GPT's panel was `gpt-6-sol, claude-sonnet-5, grok-4.7`.
- **Judges:** `grok-4.7` and `kimi-k3`, one blinded packet each covering all 18 pairs. Neither shares a vendor with either worker, so there is no self-vendor bias to report. Each judge scored correctness, simplicity, verification evidence, and scope discipline from 1 to 5 and named a preferred submission or a tie. Labels were shuffled per pair with seed 20261002.
- **Runtime:** Copilot CLI 1.0.89-4, harness at `254d3ee` plus the extract change in this commit.

Raw outputs are in [2026-10-02-direction/](2026-10-02-direction/): [report.md](2026-10-02-direction/report.md) (the generated tables), [results.json](2026-10-02-direction/results.json), [judge-packet.md](2026-10-02-direction/judge-packet.md), both judge verdicts and raw replies, and one `.diff` and one compact `.events.jsonl` extract per run. Full workdirs, replies, and session state are archived under the gitignored `evals/copilot/archive/2026-10-02-direction-*`, which `results.json` points at.

## Spend

Before any run, two single runs checked the multipliers. A sonnet arm B run and a `gpt-6-sol` arm A run each cost 1 premium request, and both counted toward the 27 worker runs.

| Spend | Requests |
| --- | --- |
| Worker runs, sonnet B, `gpt-6-sol` A, `gpt-6-sol` B | 27 |
| Judges, `grok-4.7` and `kimi-k3` | 2 |
| New in this check | 29 |
| Before this check (probes and calibration) | 87.8 |
| Cumulative | about 116.8 |

Each worker run's session log reports exactly 1 premium request, with subagents included. The judge sessions do not report cost on stderr, so their 2 requests come from the 1x multipliers measured during calibration, not from a session log.

## Hidden checks

Hidden all-pass rate per worker and arm, with Wilson 95% intervals.

| Worker | Arm A | Arm B |
| --- | --- | --- |
| `claude-sonnet-5` | 4/9, 44% (19% to 73%) | 3/9, 33% (12% to 65%) |
| `gpt-6-sol` | 9/9, 100% (70% to 100%) | 9/9, 100% (70% to 100%) |

Sonnet per task.

| Task | Arm A | Arm B |
| --- | --- | --- |
| catalog-cache | 2/3 | 0/3, each run 2 of 4 checks |
| payout-split | 2/3 | 3/3 |
| reminder-scheduler | 0/3 | 0/3, each run 3 of 4 checks |

The mean fraction of hidden checks passed is 0.83 for sonnet A and 0.75 for sonnet B. Every sonnet run on reminder-scheduler, in both arms, misses the same check: a skipped local minute must roll forward to the next valid minute.

`gpt-6-sol` passes every hidden check in all 18 runs. These tasks were calibrated on sonnet, and for GPT they sit at the ceiling. The hidden checks therefore cannot separate the arms for this worker. Only the judges and the deterministic columns can.

### The catalog-cache split

Sonnet arm B's 0/3 on catalog-cache comes from one reading of the task. The original cache stores rejected promises for the full TTL. The prompt describes a service that "kept returning errors for those same items until we restarted it" and asks to coalesce work "without changing the time-to-live behavior". The fixture README says the cache stores item data. The hidden check requires that a failed load is not reused by the next read.

All 3 sonnet B runs added in-flight coalescing and kept failure caching. They read "without changing the time-to-live behavior" as protecting the negative-cache window, and they explained the outage symptom as concurrent stragglers sliding that window forward. Sonnet A dropped failure caching in 2 of 3 runs, and `gpt-6-sol` dropped it in all 6.

Both judges sided with sonnet B. On pairs 1 and 3, both preferred the B submission that fails 2 of 4 hidden checks over the A submission that passes all 4. Both cited the instruction not to change TTL behavior. The fixture therefore admits a reading that two independent judges consider correct. Three runs cannot tell whether pstack pushed sonnet toward that reading or whether sonnet B drew it by chance. Before any main run, the prompt should say outright that errors must not outlive the outage, so the hidden check and the request agree.

## Judges

Preferences per worker. A tie counts for neither arm.

| Worker | `grok-4.7` | `kimi-k3` | Same verdict | Cohen's kappa |
| --- | --- | --- | --- | --- |
| `claude-sonnet-5` | B 5, A 4 | B 5, A 2, tie 2 | 6/9 | 0.44 |
| `gpt-6-sol` | B 6, A 3 | B 8, A 1 | 5/9 | -0.20 |

Per pair, as grok/kimi.

| Worker | catalog-cache | payout-split | reminder-scheduler |
| --- | --- | --- | --- |
| `claude-sonnet-5` | B/B, A/A, B/B | B/B, B/tie, B/B | A/tie, A/B, A/A |
| `gpt-6-sol` | B/B, B/B, B/B | A/B, A/B, A/B | B/A, B/B, B/B |

Both judges lean toward B for both workers. Where they agree, they pick B in 9 pairs and A in 2. Agreement is weak, though. For GPT, kappa is below zero, which is worse than chance at the pair level. The GPT disagreement is concentrated on payout-split. Grok preferred A all 3 times, for exact BigInt or common-denominator arithmetic. Kimi preferred B all 3 times, calling A over-engineered, with a new throwing contract and README edits nobody asked for. That is a disagreement over what the rubric rewards, not noise. On these pairs, the judge you choose decides the winner.

Mean rubric scores, out of 5.

| Judge | Worker | Arm | Correctness | Simplicity | Verification | Scope |
| --- | --- | --- | --- | --- | --- | --- |
| `grok-4.7` | sonnet | A | 4.3 | 4.2 | 3.9 | 5.0 |
| `grok-4.7` | sonnet | B | 4.9 | 4.8 | 4.6 | 5.0 |
| `grok-4.7` | GPT | A | 4.1 | 3.1 | 4.9 | 3.8 |
| `grok-4.7` | GPT | B | 4.0 | 4.0 | 4.8 | 4.3 |
| `kimi-k3` | sonnet | A | 3.9 | 4.0 | 3.0 | 4.4 |
| `kimi-k3` | sonnet | B | 4.7 | 4.3 | 4.1 | 4.9 |
| `kimi-k3` | GPT | A | 4.2 | 3.0 | 4.3 | 3.6 |
| `kimi-k3` | GPT | B | 3.8 | 3.9 | 4.7 | 4.2 |

Both judges give arm B higher simplicity and scope scores for both workers. Both also give sonnet B higher correctness than sonnet A, even though sonnet B passes fewer hidden checks. The catalog-cache split explains most of that gap.

## Deterministic columns

Totals per worker and arm across 9 runs. "src" is source lines added and removed, "test +" is test lines added, and "comments" counts new comment lines.

| Worker | Arm | src +/- | test + | files touched | comments |
| --- | --- | --- | --- | --- | --- |
| `claude-sonnet-5` | A | +173/-47 | 206 | 15 | 34 |
| `claude-sonnet-5` | B | +113/-31 | 254 | 17 | 34 |
| `gpt-6-sol` | A | +240/-98 | 734 | 30 | 1 |
| `gpt-6-sol` | B | +139/-66 | 614 | 27 | 1 |

Arm B's source diffs are about 35% smaller for sonnet and 42% smaller for GPT, measured by added lines. `gpt-6-sol` A touched 9 files outside the source and tests, the README among them, against 6 for B. This lines up with the judges' simplicity and scope scores. New comments did not move for either worker.

## Time and requests

| Worker | Arm | Requests | Total wall s | Median wall s | Total API s |
| --- | --- | --- | --- | --- | --- |
| `claude-sonnet-5` | A | 9 | 591 | 57 | 539 |
| `claude-sonnet-5` | B | 9 | 1383 | 118 | 1274 |
| `gpt-6-sol` | A | 9 | 763 | 91 | 676 |
| `gpt-6-sol` | B | 9 | 1657 | 145 | 1651 |

Arm B takes about twice as long for both workers. It costs the same in premium requests, because Copilot bills once per prompt and subagents add nothing. Sonnet A ran during calibration on 2026-09-26, so its wall times come from a different day and load.

## Routing compliance in arm B

From each run's `events.jsonl`, via `node evals/copilot/compliance.mjs results/2026-10-02-direction`. The script gives the same table from the committed extracts as from the archived full logs.

| Run | Worker | Context | poteto-mode | Playbook | Dispatches | On sheet | Dispatch models | Denies |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| catalog-cache r1 | `claude-sonnet-5` | yes | yes | bug-fix | 1 | 1 | `pstack:poteto-agent@claude-sonnet-5` | 0 |
| catalog-cache r2 | `claude-sonnet-5` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| catalog-cache r3 | `claude-sonnet-5` | yes | no | none | 0 | 0 | none | 0 |
| payout-split r1 | `claude-sonnet-5` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| payout-split r2 | `claude-sonnet-5` | yes | no | none | 0 | 0 | none | 0 |
| payout-split r3 | `claude-sonnet-5` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| reminder-scheduler r1 | `claude-sonnet-5` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| reminder-scheduler r2 | `claude-sonnet-5` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| reminder-scheduler r3 | `claude-sonnet-5` | yes | yes | bug-fix | 1 | 1 | `pstack:poteto-agent@claude-sonnet-5` | 0 |
| catalog-cache r1 | `gpt-6-sol` | yes | yes | bug-fix, feature | 5 | 5 | `general-purpose@gpt-6-sol`, `general-purpose@claude-sonnet-5`, `general-purpose@grok-4.7`, `pstack:poteto-agent@gpt-6-sol` | 0 |
| catalog-cache r2 | `gpt-6-sol` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| catalog-cache r3 | `gpt-6-sol` | yes | yes | bug-fix | 0 | 0 | none | 0 |
| payout-split r1 | `gpt-6-sol` | yes | yes | bug-fix, opening-a-pr | 2 | 2 | `pstack:poteto-agent@gpt-6-sol`, `pstack:comment-sicko@gpt-6-sol` | 0 |
| payout-split r2 | `gpt-6-sol` | yes | yes | bug-fix, opening-a-pr | 0 | 0 | none | 0 |
| payout-split r3 | `gpt-6-sol` | yes | yes | bug-fix | 2 | 2 | `general-purpose@gpt-6-sol`, `pstack:poteto-agent@gpt-6-sol` | 0 |
| reminder-scheduler r1 | `gpt-6-sol` | yes | yes | bug-fix | 1 | 1 | `pstack:poteto-agent@gpt-6-sol` | 0 |
| reminder-scheduler r2 | `gpt-6-sol` | yes | yes | bug-fix, opening-a-pr | 0 | 0 | none | 0 |
| reminder-scheduler r3 | `gpt-6-sol` | yes | yes | bug-fix | 0 | 0 | none | 0 |

The sessionStart context reached all 18 arm B runs, and no arm A run. `gpt-6-sol` followed the chain every time. It loaded poteto-mode and read the bug-fix playbook in all 9 runs, and it invoked more skills along the way, among them how, tdd, architect, arena, why, unslop, and no-comments. Sonnet loaded poteto-mode and read the playbook in 7 of 9. In catalog-cache r3 and payout-split r2 it loaded no skill at all and fixed the bug directly. All 12 `task` dispatches used a model from the sheet. That includes the 3-model `general-purpose` panel that `gpt-6-sol` ran on catalog-cache r1, which the preToolUse hook does not gate. The hook denied nothing, which is expected when every dispatch is already on the sheet.

## Limitations

- **Sample size.** Nine pairs per worker. Even a perfect 9/9 in sonnet B (70% to 100%) would still overlap sonnet A's 4/9 interval (19% to 73%).
- **Reused arm A.** Sonnet A comes from calibration, 6 days earlier, on an older harness commit. The fixtures and grading are the same, and its results were regraded in this run, but the model service, load, and CLI state on that day may differ.
- **GPT ceiling.** The tasks were calibrated on sonnet and are too easy for `gpt-6-sol`, so its hidden-check comparison is uninformative.
- **One contested fixture.** catalog-cache drives most of the sonnet hidden-check gap, and both judges disagree with its hidden check.
- **Residual blinding leak.** The packet strips paths, arm names, and pstack vocabulary. It cannot strip what arm B did. B diffs sometimes carry a `Co-authored-by: Copilot` commit trailer, and 6 `gpt-6-sol` B runs searched for `AGENTS.md`, `CLAUDE.md`, and `copilot-instructions.md`, which no A run did. A judge that noticed the pattern could tell the arms apart.
- **Judge cost.** Inferred from multipliers measured during calibration, not read from the judge sessions.
- **All bug fixes.** The three in-range tasks are all bug fixes, so this says nothing about the feature, refactor, or performance playbooks.

## What this shows and what it does not

It shows that the Copilot build's routing works end to end on a second vendor. The hook context reached every arm B session, `gpt-6-sol` followed poteto-mode into the bug-fix playbook every time, and every subagent dispatch used a model from the sheet, including a cross-vendor panel. Sonnet followed the chain in 7 of 9 runs. It also shows a consistent shape across both workers and both judges. Arm B produces smaller source diffs, scores higher on simplicity and scope, and takes about twice the wall time at the same premium-request cost.

It does not show that pstack improves correctness on the Copilot CLI. Sonnet B passes fewer hidden checks than sonnet A, 3/9 against 4/9, but the intervals overlap almost entirely, and one contested fixture drives the gap. `gpt-6-sol` is at the ceiling in both arms. The judges lean toward B, but they agree with each other only weakly, and for GPT their pair-level agreement is below chance. Nothing here supports a claim that pstack makes the Copilot CLI better or worse at fixing bugs.

The useful next step is the smaller design from the calibration report, with two changes this check suggests. First, tighten the catalog-cache prompt so the request and the hidden check agree. Second, calibrate the hardened fixtures on `gpt-6-sol` as well as sonnet, because a task in range for one worker can sit at the ceiling for the other.
