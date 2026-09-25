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
| `--arms` | `A,B` | arms to run |
| `--parallel` | `4` | concurrent candidate sessions |
| `--judge-model` | `gpt-5.5` | blinded judge; pick a different family from the candidates |
| `--panel` | `gpt-5.5,gemini-3.8-flash` | extra panel models written into arm B's sheet |
| `--timeout-min` | `30` | per-candidate wall clock limit |
| `--seed` | time-based | seeds the judge's label order |
| `--out` | `results/<stamp>` | output directory |
| `--no-judge` | off | skip the judge |

Each candidate gets its own `HOME` under one temp root, with `COPILOT_HOME` set to that home's `.copilot` like a default install, so nothing reads or writes the real `~/.copilot`. The root is printed at start and kept afterward for inspection: it holds each candidate's workdir, `reply.txt`, and `home/.copilot/session-state/<id>/events.jsonl`.

## Fixtures

Each fixture has `repo/` (the project the candidate works in, with visible tests), `prompt.txt` (the organic request), and `hidden/` (checks copied in only at grading time, as `.hidden/` next to `src/`).

| Fixture | Kind | Hidden checks |
| --- | --- | --- |
| `billing-core` | bug with a non-obvious cause (a promo mutates a cached pricing rule) | repeated and interleaved invoices stay correct |
| `stock-report` | multi-file feature (`report --format csv`) | RFC 4180 round-trip of commas, quotes, and newlines; filters; other formats unchanged |
| `partner-clients` | refactor across a function boundary (three drifted retry loops into one helper) | exact per-client attempts, delays, and retried statuses; one shared loop |
| `contacts-import` | performance (quadratic dedupe) | edge-case semantics unchanged; 60k rows under 1.5 s |

A fixture's visible tests pass on the starting code and its hidden checks fail on it. The `partner-clients` behavior checks pass on the starting code by design, since the task is a behavior-preserving refactor; only its structural check fails until the loops are merged.

## Grading

Deterministic, per run:

- hidden checks passed, and the candidate's own suite after the change
- diff size split into source and test lines, files touched, non-code files, and added comment lines
- from `events.jsonl`, not the candidate's reply: skills loaded, subagent dispatches and their models, whether it ran tests, files viewed, whether the routing context was injected, and premium requests

Then one blinded judge on a different model family scores each pair in a single pass on correctness, simplicity, verification evidence, and scope discipline (1 to 5), and names the submission it would merge. The judge sees each request, both diffs, and each candidate's shell commands (commands that touch the plugin or `COPILOT_HOME` are dropped) under the labels 1 and 2 in seeded random order. It never sees model names, arms, or the candidates' final messages.

## Outputs

`results/<stamp>/` holds `results.json` (every metric, with transcript paths), one `.diff` per run, `judge-packet.md`, `judge-raw.txt`, `judge.json` (unblinded), and `report.md` (generated tables; add the synthesis by hand after reading every diff).
