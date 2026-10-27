---
"@kozo/daemon": patch
---

Closing a task in any way, `kozo close --done` and an Issue closed as completed included, now removes its worktree, keeping its branch unless cancelled, and removing a worktree also removes kozod's markers beside it, so a worktree made again at the same path is prepared afresh instead of running the gates without its dependencies.
