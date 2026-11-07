---
"@kozo/daemon": patch
---

An item that is held when its last task merges, or when a task stops for its scope, no longer stays in Building for good: the check after the merge, and the split, wait until the hold clears.
