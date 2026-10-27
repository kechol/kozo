---
"@kozo/cli": patch
"@kozo/daemon": patch
"@kozo/verify": patch
---

The verify session's shell, in kozod and in `kozo verify`, can no longer read the factory's home, which holds the API token, except the worktree under test, as a task's shell already could not.
