---
"@kozo/daemon": patch
---

Every later run of a prepared worktree now starts its services again before it goes on, from a checkout of the merged code beside the worktree with the worktree's ports and task ID, so a database container that stopped with the machine or by hand no longer leaves the gates failing. Services commands should start what is not running and leave running services alone, as the constraints template now says.
