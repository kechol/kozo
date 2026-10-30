---
"@kozo/verify": patch
---

The review judge now reads lockfiles like any other file, up to 400 lines of each; before, it saw only their names and line counts, so a changed package source or checksum went unread.
