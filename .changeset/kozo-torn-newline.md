---
"@kozo/core": patch
"@kozo/daemon": patch
---

kozod now also drops a last event-log line that a crash left whole but for its newline; before, it kept the line and glued the next event onto it, so the start after that failed.
