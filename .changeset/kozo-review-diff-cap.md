---
"@kozo/cli": patch
"@kozo/daemon": patch
"@kozo/verify": patch
---

The review judge, in kozod and in `kozo review`, now reads at most 400 diff lines of a file and 4,000 in all, and no lockfile; its instructions name each file cut or left out with the lines it adds and removes, so a dependency update no longer fills the session with lines nobody wrote.
