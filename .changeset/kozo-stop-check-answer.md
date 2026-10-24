---
"@kozo/worker": patch
---

The stop-check now sends an agent back when it hands in its answer before the gates passed on its last commit or before it noted a decision, in both runtimes; Claude Code used to end the session at the answer whatever the check said.
