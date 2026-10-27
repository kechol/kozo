---
"@kozo/daemon": patch
"@kozo/verify": patch
"@kozo/worker": patch
---

Every command kozod runs for a task, prepare, services, gates, prove, codemods and the agent's `kozo_gates`, now ends within the Charter's `limits.max_minutes`: past it the command and everything it started get SIGTERM, then SIGKILL 10 seconds later, and the command fails with exit code 124 and a line saying it ran out of time. `kozo gates` run by hand has no limit.
