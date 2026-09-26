# Copilot A/B harness

A blinded A/B harness for the GitHub Copilot build. Arm A is the plain Copilot CLI with nothing installed. Arm B is the Copilot CLI with pstack installed from a clean export of this checkout's `HEAD`, plus a pre-written model sheet so `setup-pstack` does not block. Each pair gets the same model and the same organic prompt.

This directory is harness-only. Candidates never see it: every run happens in a sanitized temp directory named like a real project, and arm B installs from an export that has this directory removed.

## Run

Needs the `copilot` CLI signed in, `git`, and Node 24 (fixtures use Node's built-in TypeScript type stripping and `node --test`, with no dependencies).

```shell
node evals/copilot/run.mjs                               # all fixtures, claude-sonnet-5, 1 rep, both arms
node evals/copilot/run.mjs --tasks billing-core --models claude-sonnet-5,gpt-5.5 --reps 3
node evals/copilot/run.mjs --models gpt-5-mini --judge-model gpt-5-mini --out /tmp/dry   # cheap mechanics check
```

| Flag | Default | Meaning |
| --- | --- | --- |
| `--tasks` | every fixture | comma-separated fixture names |
| `--models` | `claude-sonnet-5` | candidate models; each pair runs both arms on one model |
| `--reps` | `1` | repetitions per task and model |
| `--rep-start` | `1` | number of the first rep, so a later run can add reps to an earlier one |
| `--arms` | `A,B` | arms to run |
| `--parallel` | `4` | concurrent candidate sessions |
| `--judge-model` | `grok-4.7` | blinded judge; pick a different family from the candidates |
| `--panel` | `claude-sonnet-5,grok-4.7` | extra panel models written into arm B's sheet |
| `--timeout-min` | `30` | per-candidate wall clock limit |
| `--seed` | time-based | seeds the judge's label order |
| `--out` | `results/<stamp>` | output directory |
| `--archive` | `archive/<stamp>` | where each run's workdir, reply, and session state are kept (gitignored) |
| `--no-judge` | off | skip the judge |

Each candidate gets its own `HOME` under one temp root, with `COPILOT_HOME` set to that home's `.copilot` like a default install, so nothing reads or writes the real `~/.copilot`. After grading, each run's workdir, `reply.txt`, and `session-state/` are copied to `--archive`, and the temp root can be deleted.

### Cost

Copilot CLI bills one premium request per prompt, times the model's multiplier; the agent's own tool calls and subagent turns do not add requests. A candidate session is one prompt, and so is each judge call. Multipliers depend on the account's plan, so measure them before a large run. Send one prompt per model from an isolated home and read `totalPremiumRequests` from the `session.shutdown` event in its `events.jsonl`. On the account used for the 2026-09-26 calibration, `claude-sonnet-5` and `grok-4.7` cost 1, `claude-haiku-4.5` 0.33, `gpt-5.5` 7.5, `gemini-3.8-flash` 14, and `claude-opus-5.5` 15. Keep arm B's panel on cheap models too, since a pstack panel dispatch runs on the panel model.

## Fixtures

Each fixture has `repo/` (the project the candidate works in, with visible tests), `prompt.txt` (the organic request), and `hidden/` (checks copied in only at grading time, as `.hidden/` next to `src/`).

| Fixture | Kind | Hidden checks |
| --- | --- | --- |
| `billing-core` | bug with a non-obvious cause (a promo mutates a cached pricing rule) | repeated and interleaved invoices stay correct |
| `stock-report` | multi-file feature (`report --format csv`) | RFC 4180 round-trip of commas, quotes, and newlines; filters; other formats unchanged |
| `partner-clients` | refactor across a function boundary (three drifted retry loops into one helper) | exact per-client attempts, delays, and retried statuses; one shared loop |
| `contacts-import` | performance (quadratic dedupe) | edge-case semantics unchanged; 60k rows under 1.5 s |

Each fixture also has a harness-only `reference.patch`, a minimal solution that makes every check pass. `node evals/copilot/check-fixtures.mjs [name ...]` verifies that the visible tests pass on the starting code, at least one hidden check fails on it, the reference patch makes every check pass, and nothing a candidate can see mentions the harness.

A fixture's visible tests pass on the starting code and its hidden checks fail on it. The `partner-clients` behavior checks pass on the starting code by design, since the task is a behavior-preserving refactor; only its structural check fails until the loops are merged.

## Grading

Deterministic, per run:

- hidden checks passed, and the candidate's own suite after the change
- diff size split into source and test lines, files touched, non-code files, and added comment lines
- from `events.jsonl`, not the candidate's reply: skills loaded, subagent dispatches and their models, whether it ran tests, files viewed, whether the routing context was injected, and premium requests

Then one blinded judge on a different model family scores each pair in a single pass on correctness, simplicity, verification evidence, and scope discipline (1 to 5), and names the submission it would merge. The judge sees each request, both diffs, and each candidate's shell commands (commands that touch the plugin or `COPILOT_HOME` are dropped) under the labels 1 and 2 in seeded random order. It never sees model names, arms, or the candidates' final messages.

## Outputs

`results/<stamp>/` holds `results.json` (every metric, with paths into the archive), one compact `.events.jsonl` extract per run (tool calls with shortened arguments, skills, hooks, permission events, and usage), one `.diff` per run, `judge-packet.md`, `judge-raw.txt`, `judge.json` (unblinded), and `report.md` (pass rate per arm and per task with Wilson 95% intervals, premium requests and wall time per arm, the per-run table, and the judge table; add the synthesis by hand after reading every diff).
