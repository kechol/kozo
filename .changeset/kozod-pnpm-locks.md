---
"@kozo/verify": patch
"@kozo/daemon": patch
---

Every command kozo confines, prepare, the gates, prove and the agent's `kozo_gates`, may write the three lock directories that pnpm keeps in `/tmp` whatever `TMPDIR` says and change their mode, as pnpm 12.8 does, so pnpm runs inside kozo's command sandbox.
