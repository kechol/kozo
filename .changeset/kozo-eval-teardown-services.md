---
"@kozo/daemon": patch
---

An eval case tears down the services each task started in the checkout beside its worktree too, so containers such as a task's database no longer outlive the case.
