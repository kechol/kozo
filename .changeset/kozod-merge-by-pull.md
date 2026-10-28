---
"@kozo/daemon": patch
---

In GitHub mode kozod now finds a task's merge by its pull request's merge commit once the default branch holds it, so a squash over a base that moved, or with a conflict resolved, no longer leaves the task waiting for ever; the search by patch stays for local mode and as a fallback.
