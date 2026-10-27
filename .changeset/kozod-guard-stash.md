---
"@kozo/worker": patch
---

The guard now refuses `git stash`, which the sandbox would fail after the call, and tells the agent to commit or keep editing instead; `git stash list` and `git stash show` stay allowed.
