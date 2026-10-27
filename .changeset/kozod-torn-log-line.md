---
"@kozo/core": patch
"@kozo/daemon": patch
---

kozod now starts after a crash that cut the last line of an event log short: it drops that line, which no state applied, truncates the log to its last whole line and says on stderr how many bytes it dropped. Any other broken line still keeps kozod from starting.
