---
"@kozo/daemon": patch
---

A take, close or `pause --now` while a resumed run starts a worktree's services again stops the run where it resumed, like a stop during any other command; before, the run failed and the next one started the task over.
