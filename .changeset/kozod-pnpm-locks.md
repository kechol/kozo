---
"@kozo/verify": patch
---

prepare may write the lock directories that pnpm keeps in `/tmp` whatever `TMPDIR` says, so `pnpm install` works inside kozo's command sandbox.
