---
"@kozo/daemon": patch
---

After verify-app, kozod keeps the verify session's evidence and puts the worktree back at HEAD, naming what the session left there in the node's summary and the run's log, so files the session wrote no longer make final verification fail its rebase or reach the next implement session's commit.
