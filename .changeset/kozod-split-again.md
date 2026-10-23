---
"@kozo/core": minor
"@kozo/daemon": minor
---

When an implement session calls `kozo_blocked` with the reason `scope`, kozod cancels the task and the open tasks that depend on it, removes their worktrees and branches, and sends the item from Building back to Planning. The plan agent then splits the remaining work from the tasks so far and the stopped task's question and proposed split, and its plan waits for your approval at every autonomy level. Finished tasks and open tasks that do not depend on the stopped one stay as they are.
