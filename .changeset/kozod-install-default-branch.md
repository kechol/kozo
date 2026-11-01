---
"@kozo/daemon": patch
"@kozo/verify": patch
---

In GitHub mode, the `kozo check` workflow that `kozo admin install` opens runs on pushes to the repository's own default branch, instead of a branch named `main` whatever the repository uses.
