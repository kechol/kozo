---
"@kozo/daemon": patch
---

A task's next attempt after a failed check waits for room in the daily budget, and for the factory to be resumed, like any new work; `kozo say --ask` answers one question at a time, counts running work's reservations against the budget, and is stopped and waited for when kozod stops; and kozod no longer starts one more run than `concurrency` allows when a merged task's check takes a slot at the same moment.
