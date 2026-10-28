---
"@kozo/daemon": patch
---

kozod no longer hands one port to two worktrees that prepare at once: it keeps the ports it handed out and holds each one open until the worktree's ports file names it.
