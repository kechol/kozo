---
"@kozo/core": patch
"@kozo/daemon": patch
"@kozo/dashboard": patch
---

An approval hold now says which approval it waits for, the item's start or its plan, and kozod, the GitHub sync, the inbox and the dashboard read that instead of the hold's reason text; the inbox's rows carry it as `approval`.
