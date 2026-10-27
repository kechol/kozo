---
"@kozo/daemon": patch
"@kozo/verify": patch
---

`kozo take`, `kozo close`, the cancel of a task and `kozo pause --now` now stop the command a task's run is running, such as its gates or prove, as well as its agent session, and answer once the run has ended as stopped at its node, so the next run resumes there; a human who takes a task no longer has their edits dropped by a check still running in its worktree.
