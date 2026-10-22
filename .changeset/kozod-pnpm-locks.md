---
"@kozo/verify": patch
"@kozo/daemon": patch
---

Every command kozo confines, prepare, the gates, prove and the agent's `kozo_gates`, may write the lock directories that pnpm keeps in `/tmp` whatever `TMPDIR` says, so pnpm runs inside kozo's command sandbox.
