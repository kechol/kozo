---
"@kozo/daemon": patch
---

`kozod` checks a merged task at Complete in the next free slot, before it starts new work, so items complete and dependent tasks start soon after a merge even while other tasks wait to run.
