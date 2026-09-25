# Copilot A/B run 2026-09-25T04-17-21

Arms: A = plain Copilot CLI, B = Copilot CLI with pstack installed. Models: claude-sonnet-5. Reps: 1. Judge: gpt-5.5.

## Deterministic results

| task | model | rep | arm | hidden | own suite | files | src +/- | test + | comments | ran tests | skills | subagents | premium | wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| billing-core | claude-sonnet-5 | 1 | A | 5/5 | 5/5 | 1 | +5/-3 | 0 | 0 | yes | none | none | 1 | 33 |
| billing-core | claude-sonnet-5 | 1 | B | 5/5 | 6/6 | 2 | +7/-3 | 22 | 2 | yes | poteto-mode | none | 1 | 91 |
| contacts-import | claude-sonnet-5 | 1 | A | 7/7 | 3/3 | 1 | +15/-6 | 0 | 7 | yes | none | none | 1 | 71 |
| contacts-import | claude-sonnet-5 | 1 | B | 7/7 | 3/3 | 1 | +7/-6 | 0 | 0 | yes | poteto-mode | none | 1 | 249 |
| partner-clients | claude-sonnet-5 | 1 | A | 11/11 | 9/9 | 5 | +95/-30 | 75 | 10 | yes | none | none | 1 | 167 |
| partner-clients | claude-sonnet-5 | 1 | B | 11/11 | 13/13 | 5 | +46/-21 | 147 | 12 | yes | poteto-mode | none | 1 | 221 |
| stock-report | claude-sonnet-5 | 1 | A | 5/5 | 3/3 | 4 | +19/-2 | 0 | 0 | yes | none | none | 1 | 53 |
| stock-report | claude-sonnet-5 | 1 | B | 5/5 | 6/6 | 4 | +19/-2 | 19 | 0 | yes | poteto-mode | pstack:poteto-agent@inherit | 1 | 152 |

## Blinded judge

| pair | task | blind order | preferred | correctness A/B | simplicity A/B | verification A/B | scope A/B |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | billing-core | 1=A 2=B | B | 5/5 | 5/5 | 4/5 | 5/5 |
| P2 | contacts-import | 1=B 2=A | B | 5/5 | 4/5 | 4/5 | 5/5 |
| P3 | partner-clients | 1=B 2=A | B | 5/5 | 3/4 | 4/5 | 5/5 |
| P4 | stock-report | 1=A 2=B | B | 5/5 | 5/5 | 3/4 | 5/5 |
