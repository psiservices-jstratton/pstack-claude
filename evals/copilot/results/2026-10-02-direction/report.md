# Copilot A/B run 2026-10-02T19-30-28

Arms: A = plain Copilot CLI, B = Copilot CLI with pstack installed. Models: claude-sonnet-5, gpt-6-sol. Reps: 1, 2, 3. Judge: grok-4.7, kimi-k3.

## Pass rate per arm

| model | arm | runs | hidden all-pass | premium requests | wall s (total) | wall s (median) | routing context |
| --- | --- | --- | --- | --- | --- | --- | --- |
| claude-sonnet-5 | A | 9 | 4/9 (44%, 95% CI 19% to 73%) | 9 | 591 | 57 | 0 |
| claude-sonnet-5 | B | 9 | 3/9 (33%, 95% CI 12% to 65%) | 9 | 1383 | 118 | 9 |
| gpt-6-sol | A | 9 | 9/9 (100%, 95% CI 70% to 100%) | 9 | 763 | 91 | 0 |
| gpt-6-sol | B | 9 | 9/9 (100%, 95% CI 70% to 100%) | 9 | 1657 | 145 | 9 |

## Pass rate per task

| task | model | arm | hidden all-pass | mean hidden | errors |
| --- | --- | --- | --- | --- | --- |
| catalog-cache | claude-sonnet-5 | A | 2/3 (67%, 95% CI 21% to 94%) | 0.83 | 0 |
| reminder-scheduler | claude-sonnet-5 | A | 0/3 (0%, 95% CI 0% to 56%) | 0.75 | 0 |
| payout-split | claude-sonnet-5 | A | 2/3 (67%, 95% CI 21% to 94%) | 0.92 | 0 |
| catalog-cache | claude-sonnet-5 | B | 0/3 (0%, 95% CI 0% to 56%) | 0.50 | 0 |
| catalog-cache | gpt-6-sol | A | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| catalog-cache | gpt-6-sol | B | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| payout-split | gpt-6-sol | A | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| payout-split | gpt-6-sol | B | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| reminder-scheduler | gpt-6-sol | A | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| reminder-scheduler | gpt-6-sol | B | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| payout-split | claude-sonnet-5 | B | 3/3 (100%, 95% CI 44% to 100%) | 1.00 | 0 |
| reminder-scheduler | claude-sonnet-5 | B | 0/3 (0%, 95% CI 0% to 56%) | 0.75 | 0 |

## Deterministic results

| task | model | rep | arm | hidden | own suite | files | src +/- | test + | comments | ran tests | skills | subagents | premium | wall s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| catalog-cache | claude-sonnet-5 | 1 | A | 4/4 | 7/7 | 2 | +15/-2 | 76 | 8 | yes | none | none | 1 | 105 |
| catalog-cache | claude-sonnet-5 | 2 | A | 2/4 | 5/5 | 2 | +25/-9 | 56 | 3 | yes | none | none | 1 | 87 |
| reminder-scheduler | claude-sonnet-5 | 1 | A | 3/4 | 7/7 | 2 | +5/-10 | 10 | 0 | yes | none | none | 1 | 51 |
| reminder-scheduler | claude-sonnet-5 | 2 | A | 3/4 | 8/8 | 2 | +9/-4 | 15 | 3 | yes | none | none | 1 | 53 |
| reminder-scheduler | claude-sonnet-5 | 3 | A | 3/4 | 7/7 | 2 | +3/-12 | 10 | 0 | yes | none | none | 1 | 57 |
| catalog-cache | claude-sonnet-5 | 3 | A | 4/4 | 5/5 | 2 | +14/-1 | 39 | 4 | yes | none | none | 1 | 79 |
| payout-split | claude-sonnet-5 | 1 | A | 3/4 | 4/4 | 1 | +47/-3 | 0 | 10 | yes | none | none | 1 | 80 |
| payout-split | claude-sonnet-5 | 2 | A | 4/4 | 4/4 | 1 | +28/-2 | 0 | 4 | yes | none | none | 1 | 40 |
| payout-split | claude-sonnet-5 | 3 | A | 4/4 | 4/4 | 1 | +27/-4 | 0 | 2 | yes | none | none | 1 | 39 |
| catalog-cache | claude-sonnet-5 | 1 | B | 2/4 | 5/5 | 2 | +11/-0 | 60 | 10 | yes | poteto-mode, poteto-mode | pstack:poteto-agent@claude-sonnet-5 | 1 | 393 |
| catalog-cache | gpt-6-sol | 1 | A | 4/4 | 8/8 | 3 | +17/-5 | 115 | 0 | yes | none | none | 1 | 68 |
| catalog-cache | gpt-6-sol | 2 | A | 4/4 | 7/7 | 3 | +13/-5 | 123 | 0 | yes | none | none | 1 | 63 |
| catalog-cache | gpt-6-sol | 3 | A | 4/4 | 7/7 | 3 | +10/-7 | 109 | 0 | yes | none | none | 1 | 52 |
| catalog-cache | gpt-6-sol | 1 | B | 4/4 | 7/7 | 3 | +20/-8 | 101 | 0 | yes | poteto-mode, how, how, tdd, principle-model-the-domain, principle-fix-root-causes, principle-test-behavior-not-implementation, principle-prove-it-works, why, architect, arena, architect, blast-radius, poteto-mode, principle-model-the-domain, principle-prove-it-works, unslop, technical-writing, unslop | general-purpose@gpt-6-sol, general-purpose@claude-sonnet-5, general-purpose@grok-4.7, general-purpose@gpt-6-sol, pstack:poteto-agent@gpt-6-sol | 1 | 439 |
| catalog-cache | gpt-6-sol | 2 | B | 4/4 | 6/6 | 3 | +7/-3 | 78 | 0 | yes | poteto-mode, how, tdd, technical-writing, unslop | none | 1 | 77 |
| catalog-cache | gpt-6-sol | 3 | B | 4/4 | 7/7 | 3 | +8/-6 | 83 | 0 | yes | poteto-mode, how, tdd, technical-writing, unslop | none | 1 | 95 |
| payout-split | gpt-6-sol | 1 | A | 4/4 | 9/9 | 3 | +44/-6 | 69 | 0 | yes | none | none | 1 | 91 |
| payout-split | gpt-6-sol | 1 | B | 4/4 | 6/6 | 2 | +15/-3 | 54 | 0 | yes | poteto-mode, how, tdd, technical-writing, unslop, deslop, poteto-mode, principle-model-the-domain, principle-fix-root-causes, principle-prove-it-works, unslop, no-comments, no-comments | pstack:poteto-agent@gpt-6-sol, pstack:comment-sicko@gpt-6-sol | 1 | 224 |
| payout-split | gpt-6-sol | 2 | A | 4/4 | 9/9 | 3 | +33/-2 | 66 | 0 | yes | none | none | 1 | 130 |
| payout-split | gpt-6-sol | 2 | B | 4/4 | 7/7 | 2 | +17/-2 | 68 | 0 | yes | poteto-mode, tdd, unslop | none | 1 | 145 |
| payout-split | gpt-6-sol | 3 | A | 4/4 | 10/10 | 3 | +36/-6 | 72 | 1 | yes | none | none | 1 | 99 |
| payout-split | gpt-6-sol | 3 | B | 4/4 | 8/8 | 2 | +19/-2 | 57 | 0 | yes | poteto-mode, how, why, how, tdd, poteto-mode, principle-model-the-domain, principle-fix-root-causes, principle-prove-it-works, unslop | general-purpose@gpt-6-sol, pstack:poteto-agent@gpt-6-sol | 1 | 226 |
| reminder-scheduler | gpt-6-sol | 1 | A | 4/4 | 16/16 | 4 | +21/-23 | 51 | 0 | yes | none | none | 1 | 91 |
| reminder-scheduler | gpt-6-sol | 1 | B | 4/4 | 10/10 | 4 | +15/-13 | 41 | 1 | yes | poteto-mode, how, architect, tdd, principle-model-the-domain, principle-fix-root-causes, principle-test-behavior-not-implementation, principle-prove-it-works, principle-sequence-verifiable-units, poteto-mode, principle-model-the-domain, principle-prove-it-works, principle-laziness-protocol, unslop, technical-writing, unslop | pstack:poteto-agent@gpt-6-sol | 1 | 197 |
| reminder-scheduler | gpt-6-sol | 2 | A | 4/4 | 15/15 | 4 | +36/-24 | 58 | 0 | yes | none | none | 1 | 102 |
| reminder-scheduler | gpt-6-sol | 2 | B | 4/4 | 15/15 | 4 | +12/-13 | 50 | 0 | yes | poteto-mode, how, architect, tdd, principle-model-the-domain, principle-fix-root-causes, principle-test-behavior-not-implementation, principle-prove-it-works, unslop, technical-writing | none | 1 | 115 |
| reminder-scheduler | gpt-6-sol | 3 | A | 4/4 | 11/11 | 4 | +30/-20 | 71 | 0 | yes | none | none | 1 | 68 |
| reminder-scheduler | gpt-6-sol | 3 | B | 4/4 | 12/12 | 4 | +26/-16 | 82 | 0 | yes | poteto-mode, principle-fix-root-causes, principle-model-the-domain, principle-test-behavior-not-implementation, how, why, architect, principle-prove-it-works, unslop | none | 1 | 138 |
| catalog-cache | claude-sonnet-5 | 2 | B | 2/4 | 5/5 | 2 | +4/-0 | 51 | 3 | yes | poteto-mode | none | 1 | 189 |
| catalog-cache | claude-sonnet-5 | 3 | B | 2/4 | 5/5 | 2 | +10/-0 | 58 | 3 | yes | none | none | 1 | 107 |
| payout-split | claude-sonnet-5 | 1 | B | 4/4 | 7/7 | 2 | +25/-2 | 25 | 6 | yes | poteto-mode | none | 1 | 107 |
| payout-split | claude-sonnet-5 | 2 | B | 4/4 | 4/4 | 1 | +23/-4 | 0 | 4 | yes | none | none | 1 | 54 |
| payout-split | claude-sonnet-5 | 3 | B | 4/4 | 6/6 | 2 | +20/-2 | 32 | 2 | yes | poteto-mode | none | 1 | 107 |
| reminder-scheduler | claude-sonnet-5 | 1 | B | 3/4 | 7/7 | 2 | +7/-11 | 13 | 6 | yes | poteto-mode | none | 1 | 118 |
| reminder-scheduler | claude-sonnet-5 | 2 | B | 3/4 | 7/7 | 2 | +3/-4 | 10 | 0 | yes | poteto-mode | none | 1 | 173 |
| reminder-scheduler | claude-sonnet-5 | 3 | B | 3/4 | 6/6 | 2 | +10/-8 | 5 | 0 | yes | poteto-mode | pstack:poteto-agent@claude-sonnet-5 | 1 | 133 |

## Blinded judge

### grok-4.7

| pair | task | model | rep | blind order | preferred | correctness A/B | simplicity A/B | verification A/B | scope A/B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | catalog-cache | claude-sonnet-5 | 1 | 1=B 2=A | B | 3/5 | 4/4 | 4/5 | 5/5 |
| P2 | catalog-cache | claude-sonnet-5 | 2 | 1=B 2=A | A | 5/4 | 4/5 | 5/4 | 5/5 |
| P3 | catalog-cache | claude-sonnet-5 | 3 | 1=B 2=A | B | 3/5 | 4/5 | 3/5 | 5/5 |
| P4 | catalog-cache | gpt-6-sol | 1 | 1=B 2=A | B | 3/3 | 3/4 | 5/5 | 4/4 |
| P5 | catalog-cache | gpt-6-sol | 2 | 1=A 2=B | B | 3/3 | 4/5 | 5/4 | 4/4 |
| P6 | catalog-cache | gpt-6-sol | 3 | 1=A 2=B | B | 3/3 | 4/5 | 5/4 | 4/4 |
| P7 | payout-split | claude-sonnet-5 | 1 | 1=A 2=B | B | 3/5 | 3/5 | 2/5 | 5/5 |
| P8 | payout-split | claude-sonnet-5 | 2 | 1=A 2=B | B | 5/5 | 5/5 | 3/4 | 5/5 |
| P9 | payout-split | claude-sonnet-5 | 3 | 1=A 2=B | B | 5/5 | 4/5 | 3/5 | 5/5 |
| P10 | payout-split | gpt-6-sol | 1 | 1=A 2=B | A | 5/4 | 3/5 | 5/5 | 4/5 |
| P11 | payout-split | gpt-6-sol | 2 | 1=B 2=A | A | 5/4 | 3/3 | 5/5 | 4/5 |
| P12 | payout-split | gpt-6-sol | 3 | 1=B 2=A | A | 5/4 | 3/3 | 5/5 | 4/5 |
| P13 | reminder-scheduler | claude-sonnet-5 | 1 | 1=B 2=A | A | 5/5 | 4/5 | 5/4 | 5/5 |
| P14 | reminder-scheduler | claude-sonnet-5 | 2 | 1=A 2=B | A | 5/5 | 5/5 | 5/5 | 5/5 |
| P15 | reminder-scheduler | claude-sonnet-5 | 3 | 1=B 2=A | A | 5/5 | 5/4 | 5/4 | 5/5 |
| P16 | reminder-scheduler | gpt-6-sol | 1 | 1=A 2=B | B | 4/5 | 3/4 | 5/5 | 3/4 |
| P17 | reminder-scheduler | gpt-6-sol | 2 | 1=A 2=B | B | 4/5 | 2/4 | 5/5 | 3/4 |
| P18 | reminder-scheduler | gpt-6-sol | 3 | 1=A 2=B | B | 5/5 | 3/3 | 4/5 | 4/4 |

### kimi-k3

| pair | task | model | rep | blind order | preferred | correctness A/B | simplicity A/B | verification A/B | scope A/B |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| P1 | catalog-cache | claude-sonnet-5 | 1 | 1=B 2=A | B | 2/5 | 3/4 | 3/5 | 3/4 |
| P2 | catalog-cache | claude-sonnet-5 | 2 | 1=B 2=A | A | 5/4 | 3/4 | 4/4 | 5/5 |
| P3 | catalog-cache | claude-sonnet-5 | 3 | 1=B 2=A | B | 2/5 | 4/5 | 4/4 | 3/5 |
| P4 | catalog-cache | gpt-6-sol | 1 | 1=B 2=A | B | 3/3 | 3/4 | 5/4 | 3/3 |
| P5 | catalog-cache | gpt-6-sol | 2 | 1=A 2=B | B | 3/3 | 4/5 | 4/4 | 3/4 |
| P6 | catalog-cache | gpt-6-sol | 3 | 1=A 2=B | B | 3/3 | 3/4 | 4/4 | 3/4 |
| P7 | payout-split | claude-sonnet-5 | 1 | 1=A 2=B | B | 4/5 | 3/4 | 2/4 | 4/5 |
| P8 | payout-split | claude-sonnet-5 | 2 | 1=A 2=B | tie | 4/4 | 4/4 | 3/4 | 5/5 |
| P9 | payout-split | claude-sonnet-5 | 3 | 1=A 2=B | B | 4/5 | 4/4 | 2/5 | 5/5 |
| P10 | payout-split | gpt-6-sol | 1 | 1=A 2=B | B | 5/4 | 2/3 | 5/5 | 3/5 |
| P11 | payout-split | gpt-6-sol | 2 | 1=B 2=A | B | 5/4 | 3/4 | 5/5 | 4/5 |
| P12 | payout-split | gpt-6-sol | 3 | 1=B 2=A | B | 5/4 | 2/4 | 4/5 | 4/5 |
| P13 | reminder-scheduler | claude-sonnet-5 | 1 | 1=B 2=A | tie | 5/5 | 5/5 | 3/4 | 5/5 |
| P14 | reminder-scheduler | claude-sonnet-5 | 2 | 1=A 2=B | B | 4/4 | 5/5 | 3/4 | 5/5 |
| P15 | reminder-scheduler | claude-sonnet-5 | 3 | 1=B 2=A | A | 5/5 | 5/4 | 3/3 | 5/5 |
| P16 | reminder-scheduler | gpt-6-sol | 1 | 1=A 2=B | A | 5/4 | 4/4 | 4/5 | 4/4 |
| P17 | reminder-scheduler | gpt-6-sol | 2 | 1=A 2=B | B | 5/4 | 3/4 | 4/5 | 4/4 |
| P18 | reminder-scheduler | gpt-6-sol | 3 | 1=A 2=B | B | 4/5 | 3/3 | 4/5 | 4/4 |

