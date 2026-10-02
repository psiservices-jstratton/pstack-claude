# Copilot A/B run 2026-09-25T04-08-49

Arms: A = plain Copilot CLI, B = Copilot CLI with pstack installed. Models: claude-sonnet-5. Reps: 1. Judge: gpt-5.5.

## Deterministic results

| task | model | rep | arm | hidden | own suite | files | src +/- | test + | comments | ran tests | skills | subagents | premium | wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| billing-core | claude-sonnet-5 | 1 | A | 5/5 | 5/5 | 2 | +7/-4 | 0 | 1 | yes | none | none | 1 | 39 |
| billing-core | claude-sonnet-5 | 1 | B | 5/5 | 6/6 | 2 | +5/-3 | 11 | 0 | yes | poteto-mode | none | 1 | 109 |
| contacts-import | claude-sonnet-5 | 1 | A | 7/7 | 3/3 | 1 | +15/-6 | 0 | 5 | yes | none | none | 1 | 54 |
| contacts-import | claude-sonnet-5 | 1 | B | 7/7 | 3/3 | 1 | +11/-6 | 0 | 3 | yes | poteto-mode, setup-pstack | none | 1 | 232 |
| partner-clients | claude-sonnet-5 | 1 | A | 11/11 | 4/4 | 4 | +107/-30 | 0 | 20 | yes | none | none | 1 | 139 |
| partner-clients | claude-sonnet-5 | 1 | B | 11/11 | 13/13 | 5 | +61/-30 | 156 | 8 | yes | poteto-mode, setup-pstack | none | 1 | 262 |
| stock-report | claude-sonnet-5 | 1 | A | 5/5 | 4/4 | 4 | +21/-2 | 14 | 2 | yes | none | none | 1 | 47 |
| stock-report | claude-sonnet-5 | 1 | B | 5/5 | 4/4 | 6 | +24/-3 | 13 | 2 | yes | poteto-mode | none | 1 | 104 |

## Blinded judge

| pair | task | blind order | preferred | correctness A/B | simplicity A/B | verification A/B | scope A/B |
| --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | billing-core | 1=A 2=B | B | 5/5 | 4/5 | 4/5 | 4/5 |
| P2 | contacts-import | 1=B 2=A | B | 5/5 | 5/5 | 3/5 | 5/5 |
| P3 | partner-clients | 1=B 2=A | B | 5/5 | 3/4 | 4/5 | 4/5 |
| P4 | stock-report | 1=A 2=B | B | 5/5 | 5/4 | 5/5 | 5/5 |
