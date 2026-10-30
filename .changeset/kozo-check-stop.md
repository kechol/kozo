---
"@kozo/daemon": patch
---

Closing or taking a merged task now stops the check of its merge, and its worktree is removed only after the gates have stopped; before, the gates kept running in a worktree being removed.
