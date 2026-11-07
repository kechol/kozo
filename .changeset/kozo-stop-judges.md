---
"@kozo/daemon": patch
"@kozo/verify": patch
---

`kozo pause --now`, `kozo take`, `kozo close` and stopping kozod end a running review or verify-app session at once instead of waiting for it to finish; the task resumes at the same node, and verify-app first puts the worktree back.
