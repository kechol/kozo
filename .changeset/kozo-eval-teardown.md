---
"@kozo/core": minor
"@kozo/daemon": minor
---

`.kozo/constraints.yml` may list `teardown`, commands that stop what `services` started. After each eval case, kozod runs the teardown of the repository's default branch in the case's clone and in each of its task worktrees, each first reset to the case's start without its untracked files, so that nothing the eval merged unread runs outside the sandbox.
