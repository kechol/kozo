---
"@kozo/cli": patch
---

`kozo diff-guard --scope` does not report a new test file outside the scope: a task may add tests wherever the repository keeps them, while existing tests stay protected.
