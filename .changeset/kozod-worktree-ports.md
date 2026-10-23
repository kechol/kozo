---
"@kozo/core": minor
"@kozo/daemon": minor
---

`.kozo/constraints.yml` may set `ports`, how many TCP ports each worktree's services and checks take. At a worktree's prepare kozod picks that many free ports on 127.0.0.1 and keeps them for the task's life, and services, prepare, the gates, prove, `kozo_gates` and the check at Complete get them as `KOZO_PORT_1` and on and `KOZO_PORTS`. Every command also gets `KOZO_TASK_ID`, a name unique to the worktree that suits a container project name. With them, several worktrees of a repository whose checks start servers or databases can check at once.
