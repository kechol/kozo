---
"@kozo/daemon": patch
---

A task's services now always run in one checkout of the default branch kept beside its worktree for the task's life, from its first prepare on; before, the first run started them in the worktree and later runs in a checkout removed right after, so a relative mount could point at a directory that was gone. A worktree that carries the task's changes no longer holds its services back, since they never run on it.
