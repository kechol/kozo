---
"@kozo/daemon": minor
---

`kozod` runs the factory in local mode. It takes items into `~/.kozo/items/`, triages each in a read-only checkout, asks for start and plan approvals by autonomy level, and runs the bugfix blueprint for each task in its own worktree and branch: an implement session in a sandboxed worker, then gates, prove and diff-guard, review and verify, a handoff report and a final verification on the latest default branch. It holds work for questions, attention, capacity and pauses, stops new work when the daily budget or the Charter's backpressure is reached, completes a task once its branch is merged and DONE_WHEN holds, and resumes interrupted runs from their checkpoints. Every event goes to append-only logs, from which `kozo.db` is rebuilt at each start, and the local API on `127.0.0.1:7420` serves the CLI.
