---
"@kozo/core": minor
"@kozo/worker": minor
"@kozo/daemon": minor
---

The implement agent runs its gates with the `kozo_gates` tool instead of `kozo gates` in its shell. The worker runs them in the task's command sandbox, the one `kozod`'s own gates use, so browser tests and the deep gates run during the session. Stop-check accepts only a pass at the brief's level on the agent's last commit with nothing left uncommitted, and the guard refuses `kozo` in the agent's shell. The worker spec is version 2.
