---
"@kozo/daemon": minor
"@kozo/verify": minor
"@kozo/worker": minor
---

`runtime: cli` in `factory.yml` runs each agent session as `claude -p` instead of through the Agent SDK, with the same guard, sandbox, instructions and kozo tools. Judges and the verify session still run through the Agent SDK.
