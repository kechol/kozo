---
"@kozo/daemon": patch
---

In GitHub mode kozod looks up a task's pull request at most once per GitHub poll instead of every minute, and a failed lookup no longer keeps it from noticing a merge it can see in the repository.
