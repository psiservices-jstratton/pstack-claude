# reminder-scheduler

Schedules reminder deliveries for user accounts. Each reminder stores an IANA time zone plus the wall-clock hour and minute the user picked.

Rules:

- Daily and weekly reminders preserve the requested wall-clock time in the user's time zone.
- All returned delivery times are ISO UTC strings.
- Date math must use `Intl` with the reminder's explicit time zone; the machine time zone is irrelevant.
- If a requested local minute does not exist because clocks jump forward, deliver at the next valid minute in that time zone.

Run the tests with `npm test` (Node 24, no dependencies).
