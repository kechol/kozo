---
"@kozo/daemon": minor
---

In GitHub mode, a question can be answered on its Issue. While an item or a task waits on a question, `kozod` takes the first reply after its question comment by someone with write, maintain or admin permission as the answer, as `kozo say` would, and work resumes. The reply reaches the agent as untrusted data. Replies by anyone else, by bots, and replies posted before the question are ignored.
