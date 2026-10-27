---
"@kozo/core": patch
"@kozo/daemon": patch
---

An item whose check fails after its last task's merge now goes straight back to Triage instead of passing through Complete, so its Issue is never closed in between, and an Issue kozod closed itself no longer moves its item.
